import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import express from "express";
import { config } from "./config.js";
import { bootstrapAdmin, closeDatabase, migrate, pool } from "./db.js";
import { authenticate, errorMiddleware, requestContext } from "./http.js";
import { attachRealtime } from "./realtime.js";
import { startDataMaintenance } from "./maintenance.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { clientRouter } from "./routes/client.js";
import { internalRouter } from "./routes/internal.js";
import { downloadRouter, publicRouter } from "./routes/public.js";
import { APP_VERSION } from "./version.js";

export async function createApplication(initializeDatabase = true) {
  if (initializeDatabase) {
    await migrate();
    await bootstrapAdmin();
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestContext);
  app.use(express.json({ limit: "1mb", strict: true }));

  app.get("/healthz", async (_request, response) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "healthy", version: APP_VERSION, at: new Date().toISOString() });
    } catch {
      response.status(503).json({ status: "unhealthy", version: APP_VERSION, at: new Date().toISOString() });
    }
  });

  app.use("/api/v1/public", publicRouter);
  app.use("/downloads", downloadRouter);

  const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
  app.use(express.static(publicDirectory, {
    etag: true,
    index: false,
    maxAge: 0,
    setHeaders(response, assetPath) {
      if (/\.(?:css|js|svg)$/i.test(assetPath)) {
        response.setHeader("cache-control", "public, max-age=31536000, immutable");
      }
    },
  }));
  app.get(["/", "/admin", "/admin/{*path}"], (_request, response) => {
    response.setHeader("cache-control", "no-cache");
    response.sendFile("index.html", { root: publicDirectory });
  });

  app.use(authenticate);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1", clientRouter);
  app.use("/internal", internalRouter);

  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/") || request.path.startsWith("/internal/")) {
      next();
      return;
    }
    response.setHeader("cache-control", "no-cache");
    response.sendFile("index.html", { root: publicDirectory });
  });
  app.use((_request, response) => {
    response.status(404).json({ error_code: "NOT_FOUND", message: "接口不存在" });
  });
  app.use(errorMiddleware);
  return app;
}

async function main(): Promise<void> {
  const app = await createApplication(true);
  const server = createServer(app);
  const realtime = attachRealtime(server);
  const maintenance = startDataMaintenance();
  await new Promise<void>((resolve) => server.listen(config.port, "0.0.0.0", resolve));
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      component: "control-center",
      event_code: "SERVER_STARTED",
      version: APP_VERSION,
      port: config.port,
    }),
  );

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        component: "control-center",
        event_code: "SERVER_STOPPING",
        signal,
      }),
    );
    server.close();
    maintenance.close();
    await realtime.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  void main().catch((error) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "fatal",
        component: "control-center",
        event_code: "STARTUP_FAILED",
        message: error instanceof Error ? error.message : "Unknown startup error",
      }),
    );
    process.exit(1);
  });
}
