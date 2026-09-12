export type Role = "ADMIN" | "PROJECT_MANAGER" | "DEVELOPER";
export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type User = { id: string; name: string; email: string; role: Role };
export type Client = { id: string; name: string; contact?: string | null };
export type Project = {
  id: string;
  name: string;
  description: string;
  clientId: string;
  ownerId: string;
  client?: Client;
  owner?: User;
  _count?: { tasks: number };
  tasks?: Task[];
};
export type Task = {
  id: number;
  projectId: string;
  title: string;
  description: string;
  developerId?: string | null;
  developer?: User | null;
  project?: { id: string; name: string; ownerId?: string };
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  isOverdue: boolean;
};
export type Activity = {
  id: number;
  projectId: string;
  taskId?: number | null;
  type: string;
  message: string;
  actor: User;
  task?: { id: number; title: string } | null;
  project?: { id: string; name: string };
  fromStatus?: TaskStatus | null;
  toStatus?: TaskStatus | null;
  createdAt: string;
};
export type Notification = {
  id: number;
  title: string;
  message: string;
  readAt?: string | null;
  createdAt: string;
  project?: { name: string } | null;
  task?: { id: number; title: string } | null;
};
export type Dashboard = {
  role: Role;
  projects?: number | Project[];
  tasks?: number | Task[];
  overdue?: number;
  onlineUsers?: number;
  byStatus?: Record<string, number>;
  byPriority?: Record<string, number>;
  upcoming?: Task[];
};

export const statusLabel = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const roleLabel = (value: Role) => value === "PROJECT_MANAGER" ? "Project manager" : value.charAt(0) + value.slice(1).toLowerCase();
export const priorityLabel = (value: Priority) => value.charAt(0) + value.slice(1).toLowerCase();
export const relativeTime = (date: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};
