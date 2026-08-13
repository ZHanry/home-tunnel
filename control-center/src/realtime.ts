import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type ServerOptions } from "ws";
import { databaseEvents, one, transaction } from "./db.js";
import { parseCookieHeader } from "./http.js";
import { tokenHash } from "./security.js";

type SocketIdentity = {
  userId: string;
  deviceId: string | null;
  role: "admin" | "user";
};

type LiveSocket = WebSocket & { identity?: SocketIdentity; alive?: boolean };

let websocketClientCount = 0;

export const REALTIME_MAX_PAYLOAD_BYTES = 64 * 1024;
export const REALTIME_MAX_FRAGMENTS = 256;
export const REALTIME_MAX_BUFFERED_CHUNKS = 1024;

// ws 8.21 added these runtime limits before @types/ws exposed them. Keep the
// compatibility extension local so the compiler still validates every option
// that is already part of the public type definition.
type HardenedServerOptions = ServerOptions & {
  maxFragments: number;
  maxBufferedChunks: number;
};

type RealtimeLimits = {
  maxPayload: number;
  maxFragments: number;
  maxBufferedChunks: number;
};

// Connected realtime clients across the process, for /internal/metrics.
export function getWebsocketClientCount(): number {
  return websocketClientCount;
}

async function authenticateUpgrade(request: IncomingMessage): Promise<SocketIdentity | null> {
  const authorization = request.headers.authorization;
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookieToken = parseCookieHeader(request.headers.cookie).ht_access;
  const token = bearer ?? cookieToken;
  if (!token) return null;
  return one<SocketIdentity>(
    `SELECT s.user_id AS "userId",s.device_id AS "deviceId",u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.access_token_hash=? AND s.revoked_at IS NULL AND s.access_expires_at>home_tunnel_now()
        AND s.token_version=u.token_version AND u.status='active'`,
    [tokenHash(token)],
  );
}

export function attachRealtime(
  server: Server,
  limitOverrides: Partial<RealtimeLimits> = {},
): { close: () => Promise<void> } {
  // maxPayload applies to the complete reassembled message. The other caps
  // bound the metadata and buffer growth caused by tiny fragmented frames.
  const websocketOptions: HardenedServerOptions = {
    noServer: true,
    perMessageDeflate: false,
    maxPayload: limitOverrides.maxPayload ?? REALTIME_MAX_PAYLOAD_BYTES,
    maxFragments: limitOverrides.maxFragments ?? REALTIME_MAX_FRAGMENTS,
    maxBufferedChunks: limitOverrides.maxBufferedChunks ?? REALTIME_MAX_BUFFERED_CHUNKS,
  };
  const websocketServer = new WebSocketServer(websocketOptions);
  let closing = false;

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://internal");
    if (url.pathname !== "/api/v1/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    void authenticateUpgrade(request)
      .then((identity) => {
        if (!identity) {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        websocketServer.handleUpgrade(request, socket, head, (websocket) => {
          const live = websocket as LiveSocket;
          live.identity = identity;
          live.alive = true;
          websocketServer.emit("connection", websocket, request);
        });
      })
      .catch(() => socket.destroy());
  });

  websocketServer.on("connection", (socket: LiveSocket) => {
    websocketClientCount += 1;
    // Protocol and resource-limit violations are reported through the socket
    // error event before ws closes the connection. Treat them as a client
    // failure, not as an uncaught process error.
    socket.on("error", () => undefined);
    socket.once("close", () => {
      websocketClientCount -= 1;
    });
    socket.on("pong", () => {
      socket.alive = true;
    });
    socket.on("message", (message) => {
      if (message.toString() === "ping") socket.send("pong");
    });
    socket.send(JSON.stringify({ event: "realtime.connected", at: new Date().toISOString() }));
  });

  let draining = false;
  let drainAgain = false;
  const drainOutbox = async () => {
    if (draining) {
      drainAgain = true;
      return;
    }
    draining = true;
    try {
      let count = 0;
      do {
        drainAgain = false;
        count = await transaction(async (client) => {
          const events = await client.query<{
            id: string;
            event_type: string;
            resource_type: string;
            resource_id: string;
            resource_version: string;
            recipient_user_id: string | null;
            recipient_device_id: string | null;
            payload: Record<string, unknown>;
            created_at: Date;
          }>(
            `SELECT id,event_type,resource_type,resource_id,resource_version,
                recipient_user_id,recipient_device_id,payload,created_at
           FROM outbox_events WHERE delivered_at IS NULL ORDER BY id LIMIT 100`,
          );
          const delivered: string[] = [];
          for (const event of events.rows) {
            const serialized = JSON.stringify({
              event: event.event_type,
              resource_type: event.resource_type,
              resource_id: event.resource_id,
              resource_version: Number(event.resource_version),
              payload: event.payload,
              at: event.created_at,
            });
            for (const clientSocket of websocketServer.clients) {
              const live = clientSocket as LiveSocket;
              if (live.readyState !== WebSocket.OPEN || !live.identity) continue;
              const isAdmin = live.identity.role === "admin";
              const isRecipient =
                (!event.recipient_user_id || event.recipient_user_id === live.identity.userId) &&
                (!event.recipient_device_id ||
                  event.recipient_device_id === live.identity.deviceId);
              if (isAdmin || isRecipient) {
                if (live.bufferedAmount > 1024 * 1024) {
                  live.terminate();
                  continue;
                }
                try {
                  live.send(serialized);
                } catch {
                  live.terminate();
                }
              }
            }
            delivered.push(event.id);
          }
          if (delivered.length) {
            const parameters = delivered.map(() => "?").join(",");
            await client.query(
              `UPDATE outbox_events SET delivered_at=home_tunnel_now() WHERE id IN (${parameters})`,
              delivered,
            );
          }
          return events.rowCount ?? events.rows.length;
        });
      } while (!closing && (count === 100 || drainAgain));
    } finally {
      draining = false;
    }
  };

  const reportOutboxError = (error: unknown) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        component: "control-center",
        event_code: "OUTBOX_PUBLISH_ERROR",
        message: error instanceof Error ? error.message : "Unknown outbox error",
      }),
    );
  };

  const onOutbox = () => void drainOutbox().catch(reportOutboxError);
  databaseEvents.on("outbox", onOutbox);
  void drainOutbox().catch(reportOutboxError);

  const fallbackTimer = setInterval(() => {
    void drainOutbox().catch(reportOutboxError);
  }, 30_000);
  fallbackTimer.unref();

  const pingTimer = setInterval(() => {
    for (const clientSocket of websocketServer.clients) {
      const live = clientSocket as LiveSocket;
      if (live.alive === false) {
        live.terminate();
        continue;
      }
      live.alive = false;
      live.ping();
    }
  }, 30_000);

  return {
    close: async () => {
      closing = true;
      clearInterval(fallbackTimer);
      clearInterval(pingTimer);
      databaseEvents.off("outbox", onOutbox);
      for (const socket of websocketServer.clients) socket.close(1001, "server shutdown");
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    },
  };
}
