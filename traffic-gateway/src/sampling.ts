import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { log, metrics } from "./observability.js";
import type { Policy } from "./policy.js";

export type Sample = {
  bucket_start: string;
  bucket_seconds: number;
  user_id: string;
  device_id: string;
  connection_id: string;
  upload_bytes: number;
  download_bytes: number;
  request_count: number;
  error_count: number;
};
type SampleBatchUploader = (samples: Sample[]) => Promise<void>;

async function uploadSampleBatch(batch: Sample[]): Promise<void> {
  const response = await fetch(`${config.controlCenterUrl}/internal/traffic/samples`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-home-tunnel-key": config.internalKey },
    body: JSON.stringify({ batch_id: randomUUID(), samples: batch }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`sample upload returned ${response.status}`);
}

export class SampleCollector {
  private samples = new Map<string, Sample>();
  private lastUploadFailureAt = Number.NEGATIVE_INFINITY;
  private lastUploadFailure = "";
  private lastOverflowLogAt = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly uploader: SampleBatchUploader = uploadSampleBatch,
    private readonly maxBufferedSamples: number = 5000,
  ) {}
  private bucketStart(): string {
    const bucketMs = config.sampleBucketSeconds * 1000;
    return new Date(Math.floor(this.now() / bucketMs) * bucketMs).toISOString();
  }
  private current(policy: Policy): Sample {
    const start = this.bucketStart();
    const key = `${policy.connection_id}:${start}`;
    const existing = this.samples.get(key);
    const sample =
      existing && existing.user_id === policy.user_id && existing.device_id === policy.device_id
        ? existing
        : {
            bucket_start: start,
            bucket_seconds: config.sampleBucketSeconds,
            user_id: policy.user_id,
            device_id: policy.device_id,
            connection_id: policy.connection_id,
            upload_bytes: 0,
            download_bytes: 0,
            request_count: 0,
            error_count: 0,
          };
    this.samples.set(key, sample);
    this.evictOverflow();
    return sample;
  }
  private evictOverflow(): void {
    if (this.samples.size <= this.maxBufferedSamples) return;
    const currentStart = this.bucketStart();
    let dropped = 0;
    while (this.samples.size > this.maxBufferedSamples) {
      let oldest = "";
      for (const sample of this.samples.values())
        if (!oldest || sample.bucket_start < oldest) oldest = sample.bucket_start;
      if (!oldest || oldest === currentStart) break;
      for (const [key, sample] of this.samples)
        if (sample.bucket_start === oldest) {
          this.samples.delete(key);
          dropped += 1;
        }
    }
    if (!dropped) return;
    const now = this.now();
    if (now - this.lastOverflowLogAt >= 60_000) {
      log(
        "warn",
        "SAMPLE_BUFFER_OVERFLOW",
        "Sample buffer exceeded limit, dropped oldest buckets",
        { dropped_samples: dropped, buffered_samples: this.samples.size },
      );
      this.lastOverflowLogAt = now;
    }
  }
  record(policy: Policy, direction: "upload" | "download", bytes: number): void {
    metrics.bytesTotal[direction] += bytes;
    const sample = this.current(policy);
    if (direction === "upload") sample.upload_bytes += bytes;
    else sample.download_bytes += bytes;
  }
  request(policy: Policy): void {
    metrics.requestsTotal += 1;
    this.current(policy).request_count += 1;
  }
  error(policy: Policy): void {
    metrics.upstreamErrorsTotal += 1;
    this.current(policy).error_count += 1;
  }
  get bufferedSampleCount(): number {
    return this.samples.size;
  }
  async flush(): Promise<void> {
    if (!this.samples.size) return;
    const pending = [...this.samples.entries()].map(
      ([key, sample]) => [key, { ...sample }] as const,
    );
    try {
      await this.uploader(pending.map(([, sample]) => sample));
      this.lastUploadFailure = "";
      const completedAt = this.now();
      for (const [key, uploaded] of pending) {
        const current = this.samples.get(key);
        if (
          Date.parse(uploaded.bucket_start) + uploaded.bucket_seconds * 1000 <= completedAt &&
          current?.upload_bytes === uploaded.upload_bytes &&
          current.download_bytes === uploaded.download_bytes &&
          current.request_count === uploaded.request_count &&
          current.error_count === uploaded.error_count
        )
          this.samples.delete(key);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sample error";
      const now = this.now();
      if (message !== this.lastUploadFailure || now - this.lastUploadFailureAt >= 60_000) {
        log("warn", "SAMPLE_UPLOAD_FAILED", message, { buffered_samples: this.samples.size });
        this.lastUploadFailure = message;
        this.lastUploadFailureAt = now;
      }
    }
  }
}

export const samples = new SampleCollector();
