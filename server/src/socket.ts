import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import type { AuthUser } from "./types.js";
import { findVisibleProject } from "./access.js";

let io: Server;
const socketsByUser = new Map<string, Set<string>>();

function verifySocketToken(token: unknown): AuthUser {
  if (typeof token !== "string") throw new Error("missing token");
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { name: string; email: string; role: Role };
  if (!payload.sub || !payload.name || !payload.email || !Object.values(Role).includes(payload.role)) throw new Error("invalid token");
  return { id: payload.sub, name: payload.name, email: payload.email, role: payload.role };
}

export function setupSocket(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN, credentials: true } });

  io.use((socket, next) => {
    try {
      socket.data.user = verifySocketToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    const sockets = socketsByUser.get(user.id) ?? new Set<string>();
    sockets.add(socket.id);
    socketsByUser.set(user.id, sockets);
    socket.join(`user:${user.id}`);
    if (user.role === Role.ADMIN) socket.join("role:admin");
    io.emit("presence:count", getOnlineCount());

    socket.on("join-project", async (projectId: string) => {
      if (typeof projectId !== "string") return;
      const project = await findVisibleProject(projectId, user);
      // Developers can view a project shell, but must never join its broad activity room.
      // Their assigned-task events are delivered through the personal room below.
      if (project && user.role !== Role.DEVELOPER) socket.join(`project:${projectId}`);
    });
    socket.on("leave-project", (projectId: string) => {
      if (typeof projectId === "string") socket.leave(`project:${projectId}`);
    });
    socket.on("disconnect", () => {
      const current = socketsByUser.get(user.id);
      current?.delete(socket.id);
      if (current?.size === 0) socketsByUser.delete(user.id);
      io.emit("presence:count", getOnlineCount());
    });
  });
  return io;
}

export function getOnlineCount() {
  return socketsByUser.size;
}

export async function emitActivity(activityId: number, projectId: string, ownerId: string, developerId: string | null) {
  if (!io) return;
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { actor: { select: { id: true, name: true, role: true } }, task: { select: { id: true, title: true } } }
  });
  if (!activity) return;
  const payload = {
    id: activity.id,
    projectId,
    taskId: activity.taskId,
    type: activity.type,
    message: activity.message,
    actor: activity.actor,
    task: activity.task,
    fromStatus: activity.fromStatus,
    toStatus: activity.toStatus,
    createdAt: activity.createdAt
  };
  io.to(`project:${projectId}`).emit("activity:new", payload);
  io.to("role:admin").emit("activity:new", payload);
  io.to(`user:${ownerId}`).emit("activity:new", payload);
  if (developerId) io.to(`user:${developerId}`).emit("activity:new", payload);
}

export async function emitNotification(userId: string, notificationId: number) {
  if (!io) return;
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return;
  const unread = await prisma.notification.count({ where: { userId, readAt: null } });
  io.to(`user:${userId}`).emit("notification:new", { notification, unread });
}

export function emitNotificationCount(userId: string, unread: number) {
  io?.to(`user:${userId}`).emit("notification:count", unread);
}
