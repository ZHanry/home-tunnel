import { z, type ZodType } from "zod";
import { HttpError } from "./http.js";

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "body";
    fieldErrors[key] ??= issue.message;
  }
  throw new HttpError(400, "VALIDATION_ERROR", "请求字段校验失败", { field_errors: fieldErrors });
}

export const uuid = z.string().uuid();
export const positiveVersion = z.number().int().positive();
export const nullableBandwidth = z.number().int().positive().max(10_000_000_000).nullable();
// 月度流量配额（字节，NULL = 不限）；上限 1 PB，远超家用带宽一个月的物理上限。
export const nullableMonthlyQuota = z
  .number()
  .int()
  .positive()
  .max(1_000_000_000_000_000)
  .nullable();
