import { Role, type Prisma, type Project, type Task } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { AuthUser } from "./types.js";

export function projectScope(user: AuthUser): Prisma.ProjectWhereInput {
  if (user.role === Role.ADMIN) return {};
  if (user.role === Role.PROJECT_MANAGER) return { ownerId: user.id };
  return { tasks: { some: { developerId: user.id } } };
}

export function taskScope(user: AuthUser): Prisma.TaskWhereInput {
  if (user.role === Role.ADMIN) return {};
  if (user.role === Role.PROJECT_MANAGER) return { project: { ownerId: user.id } };
  return { developerId: user.id };
}

export async function findVisibleProject(id: string, user: AuthUser): Promise<Project | null> {
  return prisma.project.findFirst({ where: { id, ...projectScope(user) } });
}

export async function findVisibleTask(id: number, user: AuthUser): Promise<Task | null> {
  return prisma.task.findFirst({ where: { id, ...taskScope(user) } });
}

export function canManageProject(project: { ownerId: string }, user: AuthUser) {
  return user.role === Role.ADMIN || (user.role === Role.PROJECT_MANAGER && project.ownerId === user.id);
}

export function canManageTask(task: { project: { ownerId: string } }, user: AuthUser) {
  return user.role === Role.ADMIN || (user.role === Role.PROJECT_MANAGER && task.project.ownerId === user.id);
}

export function readableStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function readablePriority(priority: string) {
  return priority.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
