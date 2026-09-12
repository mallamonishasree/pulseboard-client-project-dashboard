import { Router } from "express";
import bcrypt from "bcryptjs";
import { ActivityType, NotificationType, Priority, Role, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, clearRefreshCookie, currentUser, hashToken, makeRefreshToken, refreshCookieName, requireRoles, setRefreshCookie, signAccessToken } from "./auth.js";
import { canManageProject, canManageTask, findVisibleProject, findVisibleTask, projectScope, readableStatus, taskScope } from "./access.js";
import { asyncHandler, AppError } from "./errors.js";
import { env } from "./env.js";
import { getOnlineCount, emitActivity, emitNotification, emitNotificationCount } from "./socket.js";
import { prisma } from "./prisma.js";

const router = Router();
const authRouter = Router();
const userOutput = { id: true, name: true, email: true, role: true } as const;

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const roleSchema = z.nativeEnum(Role);
const projectSchema = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(2000).default(""), clientId: z.string().min(1) });
const taskCreateSchema = z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(4000).default(""), developerId: z.string().min(1).nullable().optional(), status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO), priority: z.nativeEnum(Priority).default(Priority.MEDIUM), dueDate: z.coerce.date() });
const taskUpdateSchema = taskCreateSchema.partial();
const statusSchema = z.object({ status: z.nativeEnum(TaskStatus) });
const filterSchema = z.object({ status: z.nativeEnum(TaskStatus).optional(), priority: z.nativeEnum(Priority).optional(), projectId: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() });

function publicUser(user: { id: string; name: string; email: string; role: Role }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function saveRefreshToken(userId: string, rawToken: string) {
  await prisma.refreshToken.create({ data: { userId, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } });
}

function activityMessage(actor: string, taskId: number, from: TaskStatus | null, to: TaskStatus | null) {
  if (from && to) return `${actor} moved Task #${taskId} from ${readableStatus(from)} -> ${readableStatus(to)}`;
  return `${actor} updated Task #${taskId}`;
}

async function createTaskNotification(userId: string, data: { type: NotificationType; title: string; message: string; projectId: string; taskId: number }) {
  const notification = await prisma.notification.create({ data: { userId, ...data } });
  await emitNotification(userId, notification.id);
}

authRouter.post("/login", asyncHandler(async (request, response) => {
  const input = loginSchema.parse(request.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  const authUser = publicUser(user);
  const refreshToken = makeRefreshToken();
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(response, refreshToken);
  response.json({ accessToken: signAccessToken(authUser), user: authUser });
}));

authRouter.post("/refresh", asyncHandler(async (request, response) => {
  const rawToken = request.cookies?.[refreshCookieName];
  if (!rawToken) throw new AppError(401, "NO_REFRESH_TOKEN", "Refresh session is missing");
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    clearRefreshCookie(response);
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh session is invalid or expired");
  }
  const nextToken = makeRefreshToken();
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({ data: { userId: stored.userId, tokenHash: hashToken(nextToken), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000) } })
  ]);
  const authUser = publicUser(stored.user);
  setRefreshCookie(response, nextToken);
  response.json({ accessToken: signAccessToken(authUser), user: authUser });
}));

authRouter.post("/logout", asyncHandler(async (request, response) => {
  const rawToken = request.cookies?.[refreshCookieName];
  if (rawToken) await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  clearRefreshCookie(response);
  response.json({ ok: true });
}));

router.get("/me", authenticate, asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const record = await prisma.user.findUnique({ where: { id: user.id }, select: userOutput });
  if (!record) throw new AppError(401, "USER_NOT_FOUND", "User account no longer exists");
  response.json({ user: record });
}));

router.use(authenticate);

router.get("/clients", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (_request, response) => {
  response.json({ clients: await prisma.client.findMany({ orderBy: { name: "asc" } }) });
}));

router.post("/clients", requireRoles(Role.ADMIN), asyncHandler(async (request, response) => {
  const input = z.object({ name: z.string().trim().min(2).max(140), contact: z.string().trim().max(160).optional() }).parse(request.body);
  response.status(201).json({ client: await prisma.client.create({ data: input }) });
}));

router.get("/users", requireRoles(Role.ADMIN), asyncHandler(async (_request, response) => {
  response.json({ users: await prisma.user.findMany({ select: { ...userOutput, createdAt: true }, orderBy: { createdAt: "asc" } }) });
}));

router.get("/users/developers", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (_request, response) => {
  response.json({ users: await prisma.user.findMany({ where: { role: Role.DEVELOPER }, select: userOutput, orderBy: { name: "asc" } }) });
}));

router.post("/users", requireRoles(Role.ADMIN), asyncHandler(async (request, response) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), password: z.string().min(8), role: roleSchema }).parse(request.body);
  const user = await prisma.user.create({ data: { name: input.name, email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12), role: input.role }, select: userOutput });
  response.status(201).json({ user });
}));

router.get("/projects", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const projects = await prisma.project.findMany({
    where: projectScope(user),
    include: { client: true, owner: { select: userOutput }, _count: { select: { tasks: user.role === Role.DEVELOPER ? { where: { developerId: user.id } } : true } } },
    orderBy: { updatedAt: "desc" }
  });
  response.json({ projects });
}));

router.post("/projects", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const input = projectSchema.parse(request.body);
  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new AppError(404, "CLIENT_NOT_FOUND", "Client was not found");
  const project = await prisma.project.create({ data: { ...input, ownerId: user.id } });
  await prisma.activity.create({ data: { projectId: project.id, actorId: user.id, type: ActivityType.PROJECT_CREATED, message: `${user.name} created project ${project.name}` } });
  response.status(201).json({ project });
}));

router.get("/projects/:id", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const project = await findVisibleProject(request.params.id, user);
  if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project was not found");
  const tasks = await prisma.task.findMany({
    where: { projectId: project.id, ...(user.role === Role.DEVELOPER ? { developerId: user.id } : {}) },
    include: { developer: { select: userOutput } },
    orderBy: [{ isOverdue: "desc" }, { dueDate: "asc" }]
  });
  response.json({ project: { ...project, tasks } });
}));

router.patch("/projects/:id", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const project = await findVisibleProject(request.params.id, user);
  if (!project || !canManageProject(project, user)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project was not found");
  const input = projectSchema.partial().parse(request.body);
  if (input.clientId && !(await prisma.client.findUnique({ where: { id: input.clientId } }))) throw new AppError(404, "CLIENT_NOT_FOUND", "Client was not found");
  response.json({ project: await prisma.project.update({ where: { id: project.id }, data: input }) });
}));

router.delete("/projects/:id", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const project = await findVisibleProject(request.params.id, user);
  if (!project || !canManageProject(project, user)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project was not found");
  await prisma.project.delete({ where: { id: project.id } });
  response.status(204).send();
}));

router.post("/projects/:id/tasks", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const project = await findVisibleProject(request.params.id, user);
  if (!project || !canManageProject(project, user)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project was not found");
  const input = taskCreateSchema.parse(request.body);
  if (input.developerId) {
    const developer = await prisma.user.findFirst({ where: { id: input.developerId, role: Role.DEVELOPER } });
    if (!developer) throw new AppError(400, "INVALID_DEVELOPER", "Assigned user must be a developer");
  }
  const task = await prisma.task.create({ data: { ...input, projectId: project.id }, include: { developer: { select: userOutput } } });
  const activity = await prisma.activity.create({ data: { projectId: project.id, taskId: task.id, actorId: user.id, type: ActivityType.TASK_CREATED, message: `${user.name} created Task #${task.id}` } });
  if (task.developerId) await createTaskNotification(task.developerId, { type: NotificationType.TASK_ASSIGNED, title: "New task assigned", message: `You were assigned Task #${task.id}: ${task.title}`, projectId: project.id, taskId: task.id });
  await emitActivity(activity.id, project.id, project.ownerId, task.developerId);
  response.status(201).json({ task });
}));

router.get("/tasks", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const filters = filterSchema.parse(request.query);
  const inclusiveTo = filters.to ? new Date(filters.to.setHours(23, 59, 59, 999)) : undefined;
  const dueDate = filters.from || inclusiveTo ? { ...(filters.from ? { gte: filters.from } : {}), ...(inclusiveTo ? { lte: inclusiveTo } : {}) } : undefined;
  const tasks = await prisma.task.findMany({
    where: { ...taskScope(user), ...(filters.projectId ? { projectId: filters.projectId } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.priority ? { priority: filters.priority } : {}), ...(dueDate ? { dueDate } : {}) },
    include: { project: { select: { id: true, name: true, ownerId: true } }, developer: { select: userOutput } },
    orderBy: [{ isOverdue: "desc" }, { dueDate: "asc" }]
  });
  if (user.role === Role.DEVELOPER) {
    const priorityRank: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    tasks.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.dueDate.getTime() - b.dueDate.getTime());
  }
  response.json({ tasks });
}));

router.patch("/tasks/:id/status", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const taskId = z.coerce.number().int().positive().parse(request.params.id);
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task || !(await findVisibleTask(taskId, user))) throw new AppError(404, "TASK_NOT_FOUND", "Task was not found");
  if (user.role === Role.DEVELOPER && task.developerId !== user.id) throw new AppError(403, "FORBIDDEN", "You can only update tasks assigned to you");
  if (user.role === Role.PROJECT_MANAGER && task.project.ownerId !== user.id) throw new AppError(403, "FORBIDDEN", "You can only update tasks in your projects");
  const input = statusSchema.parse(request.body);
  if (input.status === task.status) {
    response.json({ task });
    return;
  }
  const nextOverdue = input.status === TaskStatus.DONE ? false : task.isOverdue;
  const [updated, activity] = await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: input.status, isOverdue: nextOverdue }, include: { project: true, developer: { select: userOutput } } }),
    prisma.activity.create({ data: { projectId: task.projectId, taskId, actorId: user.id, type: ActivityType.STATUS_CHANGED, fromStatus: task.status, toStatus: input.status, message: activityMessage(user.name, taskId, task.status, input.status) } })
  ]);
  if (input.status === TaskStatus.IN_REVIEW && task.project.ownerId !== user.id) {
    await createTaskNotification(task.project.ownerId, { type: NotificationType.TASK_IN_REVIEW, title: "Task ready for review", message: `${user.name} moved Task #${task.id} to In Review`, projectId: task.projectId, taskId });
  }
  await emitActivity(activity.id, task.projectId, task.project.ownerId, task.developerId);
  response.json({ task: updated });
}));

router.patch("/tasks/:id", requireRoles(Role.ADMIN, Role.PROJECT_MANAGER), asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const taskId = z.coerce.number().int().positive().parse(request.params.id);
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task || !canManageTask(task, user)) throw new AppError(404, "TASK_NOT_FOUND", "Task was not found");
  const input = taskUpdateSchema.parse(request.body);
  if (input.developerId) {
    const developer = await prisma.user.findFirst({ where: { id: input.developerId, role: Role.DEVELOPER } });
    if (!developer) throw new AppError(400, "INVALID_DEVELOPER", "Assigned user must be a developer");
  }
  const updated = await prisma.task.update({ where: { id: taskId }, data: input, include: { developer: { select: userOutput }, project: true } });
  if (input.developerId && input.developerId !== task.developerId) {
    await createTaskNotification(input.developerId, { type: NotificationType.TASK_ASSIGNED, title: "New task assigned", message: `You were assigned Task #${task.id}: ${task.title}`, projectId: task.projectId, taskId });
  }
  response.json({ task: updated });
}));

router.get("/activity", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const query = z.object({ projectId: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const scope = user.role === Role.ADMIN ? {} : user.role === Role.PROJECT_MANAGER ? { project: { ownerId: user.id } } : { task: { developerId: user.id } };
  const activities = await prisma.activity.findMany({
    where: { ...scope, ...(query.projectId ? { projectId: query.projectId } : {}) },
    include: { actor: { select: userOutput }, task: { select: { id: true, title: true } }, project: { select: { id: true, name: true, ownerId: true } } },
    orderBy: { createdAt: "desc" }, take: query.limit
  });
  response.json({ activities });
}));

router.get("/dashboard", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  if (user.role === Role.ADMIN) {
    const [projects, tasks, overdue, byStatus] = await Promise.all([
      prisma.project.count(), prisma.task.count(), prisma.task.count({ where: { isOverdue: true } }), prisma.task.groupBy({ by: ["status"], _count: { _all: true } })
    ]);
    response.json({ dashboard: { role: user.role, projects, tasks, overdue, onlineUsers: getOnlineCount(), byStatus: Object.fromEntries(byStatus.map((item) => [item.status, item._count._all])) } });
    return;
  }
  if (user.role === Role.PROJECT_MANAGER) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const [projects, tasksByPriority, upcoming] = await Promise.all([
      prisma.project.findMany({ where: { ownerId: user.id }, include: { client: true, _count: { select: { tasks: true } } }, orderBy: { updatedAt: "desc" } }),
      prisma.task.groupBy({ by: ["priority"], where: { project: { ownerId: user.id } }, _count: { _all: true } }),
      prisma.task.findMany({ where: { project: { ownerId: user.id }, dueDate: { gte: start, lte: end }, status: { not: TaskStatus.DONE } }, include: { project: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 8 })
    ]);
    response.json({ dashboard: { role: user.role, projects, byPriority: Object.fromEntries(tasksByPriority.map((item) => [item.priority, item._count._all])), upcoming } });
    return;
  }
  const tasks = await prisma.task.findMany({ where: { developerId: user.id }, include: { project: { select: { id: true, name: true } } } });
  const rank: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  tasks.sort((a, b) => rank[a.priority] - rank[b.priority] || a.dueDate.getTime() - b.dueDate.getTime());
  response.json({ dashboard: { role: user.role, tasks } });
}));

router.get("/notifications", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, include: { project: { select: { name: true } }, task: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } })
  ]);
  response.json({ notifications, unread });
}));

router.patch("/notifications/:id/read", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  const id = z.coerce.number().int().positive().parse(request.params.id);
  const result = await prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  if (!result.count) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found");
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  emitNotificationCount(user.id, unread);
  response.json({ unread });
}));

router.post("/notifications/read-all", asyncHandler(async (request, response) => {
  const user = currentUser(request);
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  emitNotificationCount(user.id, 0);
  response.json({ unread: 0 });
}));

export { authRouter, router as apiRouter };
