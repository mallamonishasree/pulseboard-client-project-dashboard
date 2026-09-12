import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { api, setAccessToken } from "./api";
import type { Activity, Client, Dashboard, Notification, Priority, Project, Role, Task, TaskStatus, User } from "./types";
import { priorityLabel, relativeTime, roleLabel, statusLabel } from "./types";

const statusOptions: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
const priorityOptions: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    api.refresh().then((session) => { setAccessToken(session.accessToken); setToken(session.accessToken); setUser(session.user); }).catch(() => undefined).finally(() => setBooting(false));
  }, []);

  const login = async (email: string, password: string) => {
    const session = await api.login(email, password);
    setAccessToken(session.accessToken);
    setToken(session.accessToken);
    setUser(session.user);
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setToken(null);
    setUser(null);
  };

  if (booting) return <div className="boot-screen"><div className="brand-mark">P</div><span>Loading your workspace</span></div>;
  if (!user || !token) return <LoginScreen onLogin={login} />;
  return <Workspace user={user} token={token} onLogout={logout} />;
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("admin@pulseboard.dev");
  const [password, setPassword] = useState("Pulse123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try { await onLogin(email, password); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in"); } finally { setLoading(false); }
  };

  return <main className="auth-shell">
    <div className="auth-art">
      <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      <div className="brand-lockup"><span className="brand-mark">P</span><span>pulseboard</span></div>
      <div className="auth-headline"><span className="eyebrow">AGENCY OPERATIONS / 04</span><h1>Work moves<br /><em>in sync.</em></h1><p>A quiet command center for ambitious client work, from first brief to final review.</p></div>
      <div className="auth-signal"><span className="live-dot" /> 18 teammates active across 6 workstreams</div>
    </div>
    <div className="auth-panel"><div className="auth-panel-inner">
      <div className="mobile-brand"><span className="brand-mark">P</span> pulseboard</div>
      <span className="eyebrow">WELCOME BACK</span><h2>Good to see you.</h2><p className="muted">Sign in to your project workspace.</p>
      <form onSubmit={submit} className="auth-form"><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button full-width" disabled={loading}>{loading ? "Signing in..." : "Enter workspace"}<span>↗</span></button></form>
      <div className="demo-access"><span>DEMO ACCESS</span><div className="demo-buttons"><button onClick={() => { setEmail("admin@pulseboard.dev"); setPassword("Pulse123!"); }}>Admin</button><button onClick={() => { setEmail("ravi@pulseboard.dev"); setPassword("Pulse123!"); }}>Project manager</button><button onClick={() => { setEmail("jordan@pulseboard.dev"); setPassword("Pulse123!"); }}>Developer</button></div></div>
    </div></div>
  </main>;
}

function Workspace({ user, token, onLogout }: { user: User; token: string; onLogout: () => Promise<void> }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [developers, setDevelopers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "");
  const [priorityFilter, setPriorityFilter] = useState(() => new URLSearchParams(window.location.search).get("priority") ?? "");
  const [fromDateFilter, setFromDateFilter] = useState(() => new URLSearchParams(window.location.search).get("from") ?? "");
  const [toDateFilter, setToDateFilter] = useState(() => new URLSearchParams(window.location.search).get("to") ?? "");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [toast, setToast] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    Promise.all([api.dashboard(), api.projects(), api.notifications(), api.activity()]).then(([dash, projectResponse, notificationResponse, activityResponse]) => {
      setDashboard(dash.dashboard); setProjects(projectResponse.projects); setNotifications(notificationResponse.notifications); setUnread(notificationResponse.unread); setActivities(activityResponse.activities);
      const requestedProject = new URLSearchParams(window.location.search).get("projectId");
      if (projectResponse.projects[0]) setSelectedProject(projectResponse.projects.find((project) => project.id === requestedProject)?.id ?? projectResponse.projects[0].id);
    }).catch((error) => setToast(error.message));
    if (user.role !== "DEVELOPER") Promise.all([api.clients(), api.developers()]).then(([clientResponse, developerResponse]) => { setClients(clientResponse.clients); setDevelopers(developerResponse.users); }).catch(() => undefined);
  }, [user.role]);

  useEffect(() => {
    const nextSocket = io(import.meta.env.VITE_API_ORIGIN || undefined, { auth: { token } });
    nextSocket.on("presence:count", (count: number) => setOnlineUsers(count));
    nextSocket.on("activity:new", (activity: Activity) => {
      setActivities((current) => [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, 20));
      if (activity.taskId && activity.toStatus) setTasks((current) => current.map((task) => task.id === activity.taskId ? { ...task, status: activity.toStatus as TaskStatus, isOverdue: activity.toStatus === "DONE" ? false : task.isOverdue } : task));
    });
    nextSocket.on("notification:new", ({ notification, unread: count }: { notification: Notification; unread: number }) => { setNotifications((current) => [notification, ...current]); setUnread(count); });
    nextSocket.on("notification:count", (count: number) => setUnread(count));
    nextSocket.on("connect_error", () => setToast("Live connection unavailable. Data is still available from the API."));
    setSocket(nextSocket);
    return () => { nextSocket.disconnect(); };
  }, [token]);

  useEffect(() => {
    if (!selectedProject) return;
    socket?.emit("join-project", selectedProject);
    const params = new URLSearchParams();
    if (user.role !== "DEVELOPER") params.set("projectId", selectedProject);
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (fromDateFilter) params.set("from", fromDateFilter);
    if (toDateFilter) params.set("to", toDateFilter);
    window.history.replaceState(null, "", `?${params.toString()}`);
    Promise.all([api.tasks(`?${params.toString()}`), api.activity()]).then(([taskResponse, activityResponse]) => { setTasks(taskResponse.tasks); setActivities(activityResponse.activities); }).catch((error) => setToast(error.message));
    return () => { socket?.emit("leave-project", selectedProject); };
  }, [selectedProject, statusFilter, priorityFilter, fromDateFilter, toDateFilter, socket]);

  const activeProject = projects.find((project) => project.id === selectedProject);
  const title = user.role === "ADMIN" ? "Good morning, Maya." : `Good morning, ${user.name.split(" ")[0]}.`;
  const updateStatus = async (task: Task, status: TaskStatus) => {
    try { const response = await api.updateStatus(task.id, status); setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...response.task } : item)); setToast(`Task #${task.id} moved to ${statusLabel(status)}`); } catch (error) { setToast(error instanceof Error ? error.message : "Unable to update task"); }
  };
  const markRead = async (id: number) => { const response = await api.markRead(id); setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item)); setUnread(response.unread); };
  const markAllRead = async () => { await api.markAllRead(); setNotifications((current) => current.map((item) => ({ ...item, readAt: new Date().toISOString() }))); setUnread(0); };
  const createProject = async (data: { name: string; description: string; clientId: string }) => { const response = await api.createProject(data); setProjects((current) => [response.project, ...current]); setSelectedProject(response.project.id); setShowProjectForm(false); setToast("Project created"); };
  const projectCount = Array.isArray(dashboard?.projects) ? dashboard.projects.length : dashboard?.projects ?? projects.length;
  const taskCount = Array.isArray(dashboard?.tasks) ? dashboard.tasks.length : dashboard?.tasks ?? tasks.length;

  return <div className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><span className="brand-mark">P</span><span>pulseboard</span></div><div className="workspace-switcher"><span className="workspace-avatar">VS</span><span><b>Velozity Studio</b><small>Internal workspace</small></span><span className="caret">⌄</span></div><nav><span className="nav-label">WORKSPACE</span><button className="nav-item active"><span className="nav-icon">◈</span>Overview</button><button className="nav-item"><span className="nav-icon">□</span>Projects <span className="nav-count">{projects.length}</span></button><button className="nav-item"><span className="nav-icon">◎</span>Team</button><span className="nav-label nav-space">MANAGE</span><button className="nav-item"><span className="nav-icon">⌁</span>Activity <span className="live-mini" /></button><button className="nav-item"><span className="nav-icon">⚙</span>Settings</button></nav><div className="sidebar-footer"><div className="help-card"><span className="help-icon">?</span><div><b>Need a hand?</b><small>Visit the playbook</small></div><span>↗</span></div><div className="profile-row"><span className="avatar">{user.name.split(" ").map((part) => part[0]).join("")}</span><span><b>{user.name}</b><small>{roleLabel(user.role)}</small></span><button className="logout-button" onClick={() => void onLogout()} title="Sign out">↪</button></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div><div className="topbar-actions"><span className="connection"><span className="live-dot" /> Live sync <b>{onlineUsers || dashboard?.onlineUsers || 0}</b></span><div className="notification-wrap"><button className="icon-button" onClick={() => setNoticeOpen((open) => !open)} aria-label="Notifications">♢{unread > 0 && <span className="notification-badge">{unread > 9 ? "9+" : unread}</span>}</button>{noticeOpen && <NotificationMenu notifications={notifications} onRead={markRead} onReadAll={markAllRead} />}</div><button className="avatar top-avatar">{user.name.split(" ").map((part) => part[0]).join("")}</button></div></header><div className="content-pad"><section className="welcome-row"><div><span className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</span><h1>{title}</h1><p className="muted">Here’s the pulse of your client work today.</p></div><div className="welcome-actions">{user.role !== "DEVELOPER" && <button className="primary-button" onClick={() => setShowProjectForm(true)}>+ New project</button>}<button className="soft-button" onClick={() => window.location.reload()}>↻ Refresh</button></div></section>
      {toast && <button className="toast" onClick={() => setToast("")}>{toast}<span>×</span></button>}
      <section className="stat-grid">{user.role === "ADMIN" ? <><StatCard label="Total projects" value={String(projectCount)} trend="+2 this month" tone="green" /><StatCard label="Total tasks" value={String(taskCount)} trend="Across all workstreams" tone="blue" /><StatCard label="Overdue tasks" value={String(dashboard?.overdue ?? tasks.filter((task) => task.isOverdue).length)} trend="Needs attention" tone="orange" /><StatCard label="Team online" value={String(onlineUsers || dashboard?.onlineUsers || 0)} trend="Live presence" tone="purple" /></> : user.role === "PROJECT_MANAGER" ? <><StatCard label="My projects" value={String(projectCount)} trend="Active workstreams" tone="green" /><StatCard label="Tasks by priority" value={String(Object.values(dashboard?.byPriority ?? {}).reduce((sum, value) => sum + value, 0))} trend={`${dashboard?.byPriority?.CRITICAL ?? 0} critical`} tone="blue" /><StatCard label="Due this week" value={String(dashboard?.upcoming?.length ?? 0)} trend="Upcoming delivery" tone="orange" /><StatCard label="Team online" value={String(onlineUsers)} trend="Live presence" tone="purple" /></> : <><StatCard label="Assigned to me" value={String(Array.isArray(dashboard?.tasks) ? dashboard.tasks.length : tasks.length)} trend="Sorted by urgency" tone="green" /><StatCard label="In progress" value={String(tasks.filter((task) => task.status === "IN_PROGRESS").length)} trend="Keep momentum" tone="blue" /><StatCard label="In review" value={String(tasks.filter((task) => task.status === "IN_REVIEW").length)} trend="Awaiting feedback" tone="orange" /><StatCard label="Due soon" value={String(tasks.filter((task) => !task.isOverdue && new Date(task.dueDate).getTime() < Date.now() + 7 * 86400000).length)} trend="Next 7 days" tone="purple" /></>}</section>
      <div className="dashboard-grid"><div className="primary-column"><section className="panel projects-panel"><div className="panel-heading"><div><span className="eyebrow">{user.role === "DEVELOPER" ? "YOUR WORK" : "PORTFOLIO"}</span><h2>{user.role === "DEVELOPER" ? "Assigned tasks" : "Active projects"}</h2></div><button className="text-button">View all <span>↗</span></button></div><div className="project-list">{projects.slice(0, 3).map((project, index) => <ProjectRow key={project.id} project={project} selected={selectedProject === project.id} onClick={() => setSelectedProject(project.id)} accent={index} />)}{projects.length === 0 && <EmptyState label="No projects are visible for this account." />}</div></section>
        <section className="panel tasks-panel"><div className="panel-heading"><div><span className="eyebrow">{activeProject ? activeProject.name : "WORK QUEUE"}</span><h2>Task pipeline</h2></div><span className="task-count">{tasks.length} visible</span></div><div className="filters"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">All priorities</option>{priorityOptions.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}</select><input type="date" value={fromDateFilter} onChange={(event) => setFromDateFilter(event.target.value)} aria-label="Due date from" /><input type="date" value={toDateFilter} onChange={(event) => setToDateFilter(event.target.value)} aria-label="Due date to" /><button className="filter-clear" onClick={() => { setStatusFilter(""); setPriorityFilter(""); setFromDateFilter(""); setToDateFilter(""); }}>Clear</button></div><div className="task-table"><div className="task-table-head"><span>TASK</span><span>ASSIGNEE</span><span>PRIORITY</span><span>STATUS</span><span>DUE</span></div>{tasks.slice(0, 8).map((task) => <TaskRow key={task.id} task={task} canEdit={user.role === "DEVELOPER" ? task.developerId === user.id : true} onStatusChange={updateStatus} />)}{tasks.length === 0 && <EmptyState label="Choose a project or loosen the filters to see work." />}</div></section></div>
        <aside className="secondary-column"><section className="panel feed-panel"><div className="panel-heading"><div><span className="eyebrow">LIVE FEED</span><h2>Recent activity</h2></div><span className="live-pill"><span className="live-dot" /> Live</span></div><div className="activity-list">{activities.slice(0, 8).map((activity) => <ActivityItem key={activity.id} activity={activity} />)}{activities.length === 0 && <EmptyState label="Activity will appear here as work moves." />}</div><button className="feed-footer">Open full activity log <span>↗</span></button></section><section className="panel focus-panel"><div className="focus-orb" /><span className="eyebrow">THIS WEEK</span><h3>Keep the signal<br /><em>clear.</em></h3><p>Focus on the few moves that unblock the most work.</p><div className="focus-bar"><span style={{ width: `${Math.min(100, Math.max(12, (tasks.filter((task) => task.status === "DONE").length / Math.max(1, tasks.length)) * 100))}%` }} /></div><small>{tasks.filter((task) => task.status === "DONE").length} of {tasks.length || 0} tasks closed</small></section></aside></div>
    </div></main>{showProjectForm && <ProjectModal clients={clients} onClose={() => setShowProjectForm(false)} onCreate={createProject} />}
  </div>;
}

function StatCard({ label, value, trend, tone }: { label: string; value: string; trend: string; tone: string }) { return <div className={`stat-card tone-${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-spark">⌁</span></div><strong>{value}</strong><small><span className="trend-dot" />{trend}</small></div>; }

function ProjectRow({ project, selected, onClick, accent }: { project: Project; selected: boolean; onClick: () => void; accent: number }) { return <button className={`project-row ${selected ? "selected" : ""}`} onClick={onClick}><span className={`project-icon project-icon-${accent}`}>{project.name.slice(0, 1)}</span><span className="project-row-copy"><b>{project.name}</b><small>{project.client?.name ?? "Client project"}</small></span><span className="project-progress"><i style={{ width: `${Math.min(92, 28 + (project._count?.tasks ?? 1) * 8)}%` }} /></span><span className="project-task-count">{project._count?.tasks ?? 0} tasks</span><span className="row-arrow">↗</span></button>; }

function TaskRow({ task, canEdit, onStatusChange }: { task: Task; canEdit: boolean; onStatusChange: (task: Task, status: TaskStatus) => void }) { return <div className="task-row"><div className="task-title"><span className={`task-dot status-${task.status.toLowerCase()}`} /><span><b>#{task.id} {task.title}</b><small>{task.project?.name ?? "Project task"}</small></span></div><div className="assignee"><span className="avatar tiny-avatar">{task.developer?.name.split(" ").map((part) => part[0]).join("") ?? "--"}</span><span>{task.developer?.name.split(" ")[0] ?? "Unassigned"}</span></div><span className={`priority priority-${task.priority.toLowerCase()}`}>{priorityLabel(task.priority)}</span>{canEdit ? <select className={`status-select status-${task.status.toLowerCase()}`} value={task.status} onChange={(event) => onStatusChange(task, event.target.value as TaskStatus)}>{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select> : <span className={`status-text status-${task.status.toLowerCase()}`}>{statusLabel(task.status)}</span>}<span className={`due-date ${task.isOverdue ? "overdue" : ""}`}>{task.isOverdue ? "Overdue" : new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>; }

function ActivityItem({ activity }: { activity: Activity }) { return <div className="activity-item"><span className="activity-avatar">{activity.actor.name.split(" ").map((part) => part[0]).join("")}</span><div><p>{activity.message.replace(" -> ", " → ")}</p><small>{activity.project?.name ?? "Project activity"} <span>·</span> {relativeTime(activity.createdAt)}</small></div></div>; }
function EmptyState({ label }: { label: string }) { return <div className="empty-state"><span>+</span><p>{label}</p></div>; }

function NotificationMenu({ notifications, onRead, onReadAll }: { notifications: Notification[]; onRead: (id: number) => void; onReadAll: () => void }) { return <div className="notification-menu"><div className="notification-head"><b>Notifications</b><button onClick={onReadAll}>Mark all read</button></div>{notifications.slice(0, 6).map((notification) => <button className={`notification-item ${notification.readAt ? "read" : ""}`} key={notification.id} onClick={() => onRead(notification.id)}><span className="notification-dot" /><span><b>{notification.title}</b><small>{notification.message}</small><em>{relativeTime(notification.createdAt)}</em></span></button>)}{notifications.length === 0 && <p className="notification-empty">You’re all caught up.</p>}</div>; }

function ProjectModal({ clients, onClose, onCreate }: { clients: Client[]; onClose: () => void; onCreate: (data: { name: string; description: string; clientId: string }) => Promise<void> }) { const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [clientId, setClientId] = useState(clients[0]?.id ?? ""); const [saving, setSaving] = useState(false); const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); await onCreate({ name, description, clientId }); setSaving(false); }; return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><div className="modal-head"><div><span className="eyebrow">NEW WORKSTREAM</span><h2>Create a project</h2></div><button type="button" className="close-button" onClick={onClose}>×</button></div><label>Project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Horizon brand system" required /></label><label>Client<select value={clientId} onChange={(event) => setClientId(event.target.value)} required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label>Project brief<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does success look like?" rows={4} /></label><div className="modal-actions"><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving || !clientId}>{saving ? "Creating..." : "Create project ↗"}</button></div></form></div>; }
