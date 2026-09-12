let accessToken: string | null = null;
const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? "";

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${apiOrigin}${path}`, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? "Request failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  request,
  login: (email: string, password: string) => request<{ accessToken: string; user: import("./types").User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  refresh: () => request<{ accessToken: string; user: import("./types").User }>("/api/auth/refresh", { method: "POST" }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  dashboard: () => request<{ dashboard: import("./types").Dashboard }>("/api/dashboard"),
  projects: () => request<{ projects: import("./types").Project[] }>("/api/projects"),
  project: (id: string) => request<{ project: import("./types").Project }>(`/api/projects/${id}`),
  clients: () => request<{ clients: import("./types").Client[] }>("/api/clients"),
  developers: () => request<{ users: import("./types").User[] }>("/api/users/developers"),
  tasks: (query: string) => request<{ tasks: import("./types").Task[] }>(`/api/tasks${query}`),
  activity: (query = "?limit=20") => request<{ activities: import("./types").Activity[] }>(`/api/activity${query}`),
  notifications: () => request<{ notifications: import("./types").Notification[]; unread: number }>("/api/notifications"),
  markRead: (id: number) => request<{ unread: number }>(`/api/notifications/${id}/read`, { method: "PATCH" }),
  markAllRead: () => request<{ unread: number }>("/api/notifications/read-all", { method: "POST" }),
  updateStatus: (id: number, status: import("./types").TaskStatus) => request<{ task: import("./types").Task }>(`/api/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  createProject: (body: { name: string; description: string; clientId: string }) => request<{ project: import("./types").Project }>("/api/projects", { method: "POST", body: JSON.stringify(body) })
};
