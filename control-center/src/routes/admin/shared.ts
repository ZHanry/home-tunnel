import type { Request } from "express";
import { requireAdmin, requireCsrf, requirePasswordNormal } from "../../http.js";

export function adminGuard(request: Request) {
  const actor = requireAdmin(request);
  requirePasswordNormal(request);
  requireCsrf(request);
  return actor;
}
