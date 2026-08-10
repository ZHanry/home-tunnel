import type { Request } from "express";

export type AuthenticatedActor = {
  sessionId: string;
  userId: string;
  deviceId: string | null;
  username: string;
  displayName: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  passwordState: "normal" | "must_change";
  tokenVersion: number;
  csrfTokenHash: string;
  authSource: "bearer" | "cookie";
};

export type AuthenticatedRequest = Request & { actor?: AuthenticatedActor; requestId?: string };
