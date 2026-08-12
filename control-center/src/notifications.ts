import { config } from "./config.js";

// 告警通知通道：Webhook（POST JSON）与 Telegram sendMessage。所有投递失败
// 只记结构化日志（ALERT_DELIVERY_FAILED），绝不抛给调用方；同一
// (event_type, subject_id) 在窗口内只发一次（进程内 Map；配额/离线另有
// 持久状态列兜底重启场景）。告警内容不含口令、令牌或租约。

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEvent = {
  event_type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  // 去重主体（如 用户id:月份、设备id）；同一 (event_type, subject_id) 限频。
  subject_id: string;
  details?: Record<string, unknown>;
};

export type AlertChannelKind = "webhook" | "telegram";

export type AlertChannel =
  | { kind: "webhook"; url: string }
  | { kind: "telegram"; botToken: string; chatId: string };

export type AlertDeliveryResult = { channel: AlertChannelKind; ok: boolean; error?: string };

export type AlertSendOutcome = {
  delivered: boolean;
  deduplicated: boolean;
  results: AlertDeliveryResult[];
};

export type AlertDeliveryCounts = Record<AlertChannelKind, { ok: number; error: number }>;

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

type DispatcherOptions = {
  fetchImplementation?: FetchLike;
  deduplicationWindowMs?: number;
  timeoutMs?: number;
};

const defaultDeduplicationWindowMs = 10 * 60 * 1000;
const defaultTimeoutMs = 5_000;
// 每通道最多 2 次尝试（失败重试 1 次）。
const maximumAttemptsPerChannel = 2;
// 去重键包含用户/设备 id，规模有限；达到上限先清理过期条目再淘汰最旧的。
const deduplicationMapLimit = 2_000;

function logDeliveryFailure(channel: AlertChannelKind, event: AlertEvent, message: string): void {
  // 只记通道与事件元信息；绝不输出 URL、token 或 chat_id。
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    component: "control-center",
    event_code: "ALERT_DELIVERY_FAILED",
    channel,
    alert_event_type: event.event_type,
    severity: event.severity,
    message: message.slice(0, 256),
  }));
}

export class AlertDispatcher {
  private readonly recentEvents = new Map<string, number>();

  private readonly counts: AlertDeliveryCounts = {
    webhook: { ok: 0, error: 0 },
    telegram: { ok: 0, error: 0 },
  };

  constructor(
    private readonly channels: AlertChannel[],
    private readonly options: DispatcherOptions = {},
  ) {}

  configuredChannels(): Record<AlertChannelKind, boolean> {
    return {
      webhook: this.channels.some((channel) => channel.kind === "webhook"),
      telegram: this.channels.some((channel) => channel.kind === "telegram"),
    };
  }

  deliveryCounts(): AlertDeliveryCounts {
    return {
      webhook: { ...this.counts.webhook },
      telegram: { ...this.counts.telegram },
    };
  }

  async send(event: AlertEvent): Promise<AlertSendOutcome> {
    if (!this.channels.length) return { delivered: false, deduplicated: false, results: [] };
    if (this.isDuplicate(event)) return { delivered: false, deduplicated: true, results: [] };
    const at = new Date().toISOString();
    const results: AlertDeliveryResult[] = [];
    for (const channel of this.channels) {
      results.push(await this.deliver(channel, event, at));
    }
    return { delivered: results.some((result) => result.ok), deduplicated: false, results };
  }

  private isDuplicate(event: AlertEvent): boolean {
    const key = `${event.event_type}:${event.subject_id}`;
    const now = Date.now();
    const windowMs = this.options.deduplicationWindowMs ?? defaultDeduplicationWindowMs;
    const previous = this.recentEvents.get(key);
    if (previous != null && now - previous < windowMs) return true;
    if (this.recentEvents.size >= deduplicationMapLimit) {
      for (const [staleKey, sentAt] of this.recentEvents) {
        if (now - sentAt >= windowMs) this.recentEvents.delete(staleKey);
      }
      // Map 迭代顺序即插入顺序：仍然超限时淘汰最旧条目。
      while (this.recentEvents.size >= deduplicationMapLimit) {
        const oldest = this.recentEvents.keys().next();
        if (oldest.done) break;
        this.recentEvents.delete(oldest.value);
      }
    }
    this.recentEvents.set(key, now);
    return false;
  }

  private async deliver(channel: AlertChannel, event: AlertEvent, at: string): Promise<AlertDeliveryResult> {
    const fetchImplementation: FetchLike =
      this.options.fetchImplementation ?? ((url, init) => fetch(url, init));
    const timeoutMs = this.options.timeoutMs ?? defaultTimeoutMs;
    const { url, body } =
      channel.kind === "webhook"
        ? {
            url: channel.url,
            body: JSON.stringify({
              event_type: event.event_type,
              severity: event.severity,
              title: event.title,
              message: event.message,
              at,
              details: event.details ?? {},
            }),
          }
        : {
            url: `https://api.telegram.org/bot${channel.botToken}/sendMessage`,
            body: JSON.stringify({
              chat_id: channel.chatId,
              text: `[${event.severity}] ${event.title}\n${event.message}`,
            }),
          };
    let lastError = "delivery failed";
    for (let attempt = 1; attempt <= maximumAttemptsPerChannel; attempt += 1) {
      try {
        const response = await fetchImplementation(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
          this.counts[channel.kind].ok += 1;
          return { channel: channel.kind, ok: true };
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "delivery failed";
      }
    }
    this.counts[channel.kind].error += 1;
    logDeliveryFailure(channel.kind, event, lastError);
    return { channel: channel.kind, ok: false, error: lastError };
  }
}

function channelsFromConfig(): AlertChannel[] {
  const channels: AlertChannel[] = [];
  if (config.alerts.webhookUrl) channels.push({ kind: "webhook", url: config.alerts.webhookUrl });
  if (config.alerts.telegram) {
    channels.push({
      kind: "telegram",
      botToken: config.alerts.telegram.botToken,
      chatId: config.alerts.telegram.chatId,
    });
  }
  return channels;
}

const dispatcher = new AlertDispatcher(channelsFromConfig());

export function sendAlert(event: AlertEvent): Promise<AlertSendOutcome> {
  return dispatcher.send(event);
}

export function configuredAlertChannels(): Record<AlertChannelKind, boolean> {
  return dispatcher.configuredChannels();
}

export function alertDeliveryCounts(): AlertDeliveryCounts {
  return dispatcher.deliveryCounts();
}
