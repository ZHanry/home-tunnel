import { Transform, type TransformCallback } from "node:stream";
import { config } from "./config.js";
import { metrics } from "./observability.js";
import { type Policy, PolicyStore, policies } from "./policy.js";
import { SampleCollector, samples } from "./sampling.js";

type Bucket = {
  rateBytesPerSecond: number;
  capacity: number;
  tokens: number;
  updatedAt: number;
  version: number;
};

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const stop = () => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

export class HierarchicalLimiter {
  private userBuckets = new Map<string, Bucket>();
  private connectionBuckets = new Map<string, Bucket>();
  constructor(private readonly store: PolicyStore = policies) {}
  private bucket(
    map: Map<string, Bucket>,
    key: string,
    limitBps: number | null,
    burstBytes: number | null,
    version: number,
  ): Bucket | null {
    if (limitBps == null) {
      map.delete(key);
      return null;
    }
    const rateBytesPerSecond = Math.max(limitBps / 8, 1);
    const capacity = Math.max(
      64 * 1024,
      Math.min(8 * 1024 * 1024, burstBytes ?? rateBytesPerSecond),
    );
    const existing = map.get(key);
    if (!existing) {
      const created = {
        rateBytesPerSecond,
        capacity,
        tokens: capacity,
        updatedAt: performance.now(),
        version,
      };
      map.set(key, created);
      return created;
    }
    this.refill(existing);
    if (
      existing.version !== version ||
      existing.rateBytesPerSecond !== rateBytesPerSecond ||
      existing.capacity !== capacity
    ) {
      existing.rateBytesPerSecond = rateBytesPerSecond;
      existing.capacity = capacity;
      existing.tokens = Math.min(existing.tokens, capacity);
      existing.version = version;
    }
    return existing;
  }
  private refill(bucket: Bucket): void {
    const now = performance.now();
    bucket.tokens = Math.min(
      bucket.capacity,
      bucket.tokens + Math.max(0, (now - bucket.updatedAt) / 1000) * bucket.rateBytesPerSecond,
    );
    bucket.updatedAt = now;
  }
  async acquire(connectionId: string, requestedBytes: number, signal: AbortSignal): Promise<void> {
    let remaining = requestedBytes;
    while (remaining > 0) {
      if (signal.aborted) throw new Error("TRANSFER_ABORTED");
      const policy = this.store.connection(connectionId);
      if (!policy) throw new Error("POLICY_REVOKED");
      const user = this.bucket(
        this.userBuckets,
        policy.user_id,
        policy.user_limit_bps,
        policy.user_burst_bytes,
        policy.user_policy_version,
      );
      const connection = this.bucket(
        this.connectionBuckets,
        policy.connection_id,
        policy.connection_limit_bps,
        policy.connection_burst_bytes,
        policy.connection_policy_version,
      );
      const maximumChunk = Math.max(
        1,
        Math.floor(
          Math.min(
            user?.capacity ?? Infinity,
            connection?.capacity ?? Infinity,
            config.maxBodyChunkBytes,
          ),
        ),
      );
      const bytes = Math.min(remaining, maximumChunk);
      if (user) this.refill(user);
      if (connection) this.refill(connection);
      const waitSeconds = Math.max(
        user ? Math.max(0, (bytes - user.tokens) / user.rateBytesPerSecond) : 0,
        connection ? Math.max(0, (bytes - connection.tokens) / connection.rateBytesPerSecond) : 0,
      );
      if (waitSeconds <= 0) {
        if (user) user.tokens -= bytes;
        if (connection) connection.tokens -= bytes;
        remaining -= bytes;
        continue;
      }
      const started = performance.now();
      await abortableDelay(Math.max(1, Math.ceil(waitSeconds * 1000)), signal);
      metrics.throttleWaitSecondsTotal += (performance.now() - started) / 1000;
    }
  }
}

export const limiter = new HierarchicalLimiter();

export class ThrottleTransform extends Transform {
  constructor(
    private readonly connectionId: string,
    private readonly direction: "upload" | "download",
    private readonly controller: AbortController,
    private readonly store: PolicyStore = policies,
    private readonly limits: HierarchicalLimiter = limiter,
    private readonly collector: SampleCollector = samples,
  ) {
    super({ highWaterMark: config.maxBodyChunkBytes });
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.controller.signal.aborted) {
      callback(new Error("TRANSFER_ABORTED"));
      return;
    }
    const policy: Policy | undefined = this.store.connection(this.connectionId);
    if (!policy) {
      callback(new Error("POLICY_REVOKED"));
      return;
    }
    if (policy.user_limit_bps == null && policy.connection_limit_bps == null) {
      this.collector.record(policy, this.direction, chunk.length);
      callback(null, chunk);
      return;
    }
    void this.limits
      .acquire(this.connectionId, chunk.length, this.controller.signal)
      .then(() => {
        const current = this.store.connection(this.connectionId);
        if (!current) throw new Error("POLICY_REVOKED");
        this.collector.record(current, this.direction, chunk.length);
        callback(null, chunk);
      })
      .catch((error) => callback(error as Error));
  }
}
