import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "./env.js";
import { AppError } from "./errors.js";
import type { AuthUser } from "./types.js";

const REFRESH_COOKIE = "pulse_refresh";

export const refreshCookieName = REFRESH_COOKIE;

export function signAccessToken(user: AuthUser) {
  return jwt.sign({ sub: user.id, name: user.name, email: user.email, role: user.role }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"] });
}

export function makeRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function setRefreshCookie(response: Response, token: string) {
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
  });
}

export function clearRefreshCookie(response: Response) {
  response.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: env.NODE_ENV === "production" ? "none" : "lax", path: "/api/auth" });
}

export const authenticate: RequestHandler = (request, _response, next) => {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    next(new AppError(401, "UNAUTHENTICATED", "A valid access token is required"));
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { name: string; email: string; role: Role };
    if (!payload.sub || !payload.name || !payload.email || !Object.values(Role).includes(payload.role)) throw new Error("invalid payload");
    request.user = { id: payload.sub, name: payload.name, email: payload.email, role: payload.role };
    next();
  } catch {
    next(new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired"));
  }
};

export function requireRoles(...roles: Role[]): RequestHandler {
  return (request, _response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      next(new AppError(403, "FORBIDDEN", "You do not have permission to perform this action"));
      return;
    }
    next();
  };
}

export function currentUser(request: Request) {
  if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "A valid access token is required");
  return request.user;
}
