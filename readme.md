# Pulseboard

Pulseboard is a real-time internal project operations dashboard for a small agency. It is a TypeScript monorepo with a React/Vite client, Express API, PostgreSQL database, Prisma ORM, Socket.IO presence/activity, and a node-cron overdue task worker.

## Local setup

Requirements: Node 20+, Docker, and Docker Compose.

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npx prisma generate
npx prisma db push
npm run prisma:seed
npm run dev
```

Open `http://localhost:5173`. The seeded accounts all use `Pulse123!`:

| Role | Email |
| --- | --- |
| Admin | `admin@pulseboard.dev` |
| Project manager | `ravi@pulseboard.dev` or `elena@pulseboard.dev` |
| Developer | `jordan@pulseboard.dev`, `amara@pulseboard.dev`, `theo@pulseboard.dev`, `nisha@pulseboard.dev` |

To run the complete production-shaped container, use `docker compose up --build`. The app container runs `prisma db push` before starting the API; run `npm run prisma:seed` once against that database when demo data is needed.

## Architecture

```text
React + Vite  -- REST /api + Socket.IO --> Express + Socket.IO
                                             |
                                      Prisma / PostgreSQL
                                             |
                                     node-cron hourly job
```

The schema is relational: `User` owns `Project`; `Project` belongs to `Client` and contains `Task`; `Task` belongs to an optional developer and has durable `Activity` and `Notification` records. `RefreshToken` stores a SHA-256 hash, not the browser token. Foreign keys use cascade only where child records cannot exist independently, and restrict project/client and activity/actor deletion where audit history matters.

### Security and roles

Access tokens are short-lived JWTs returned in JSON and held in React memory only. Refresh tokens are rotated, hashed in the database, and sent in an HttpOnly, SameSite cookie scoped to `/api/auth`. Every protected route runs `authenticate`; mutation routes additionally use `requireRoles`. Query scopes are applied at the database query itself: PMs get only projects they own, developers get only tasks assigned to them, and activity is filtered using the same boundary. A forged role claim therefore cannot expand data access without the server secret.

### Real-time decisions

Socket.IO was chosen over a hand-rolled WebSocket protocol because its reconnect behavior, event acknowledgements, and room abstraction make project-scoped fan-out explicit without adding a second protocol layer. The server authenticates the socket with the access token, authorizes `join-project` against the same project scope as REST, and emits activity to the project room plus the appropriate admin/owner/developer user rooms. On reconnect, the client fetches the newest 20 persisted activity records from PostgreSQL; the socket is only the live transport, never the source of truth. Presence is a unique-user set maintained by the socket server and broadcast as a live count.

### Jobs, validation, and indexes

node-cron runs a small hourly `updateMany` job to set `Task.isOverdue` for due, unfinished tasks. It is intentionally easy to run with the API process for this small deployment; Bull/Redis would be the next step for retries and multi-instance scheduling. Zod validates all JSON bodies and query strings server-side. Errors use `{ error: { code, message, details? } }` and never expose stack traces.

Indexes target actual access paths: `(ownerId, updatedAt)` for PM project lists, `(projectId, status)` for project boards, `(developerId, status, dueDate)` for developer queues, `(dueDate, isOverdue)` for the scheduler/overdue cards, `(priority, dueDate)` for priority sorting, and `(userId, readAt, createdAt)` for notification badges and dropdowns. Activity indexes pair project/task or actor with `createdAt` for feed pagination.

## Deployment

The frontend can be deployed to Vercel with `client` as the project root and `npm run build:client` as the build command. Set the Vercel `VITE_API_ORIGIN` variable to the API URL. The Express/Socket.IO API needs a long-lived Node host such as Railway, Render, Fly.io, or a container service, with `CLIENT_ORIGIN` set to the Vercel URL and a managed PostgreSQL `DATABASE_URL`. Socket.IO is not a good fit for a short-lived Vercel serverless function. Configure the production secrets from `.env.example` in the host dashboards; never commit `.env`.

This workspace does not contain GitHub/Vercel credentials, so a public repository and live URL are deployment steps rather than fabricated links. The repository is ready to push and the Docker path above is the reproducible handoff.

## Known limitations

- The hourly cron job is single-process; run it as a dedicated worker or move it to BullMQ before horizontally scaling the API.
- Socket presence is process-local. A multi-instance deployment needs a Socket.IO Redis adapter.
- The UI keeps a single active project view at a time; the API supports direct, shareable task filters through query parameters.
- Project and user management surfaces are intentionally compact, while the complete server APIs are present for the assessment flows.

## Explanation (204 words)

The hardest problem was making the activity feed real-time without turning the browser into the authority for permissions. A task status change is committed in one Prisma transaction with the new task row and a durable Activity row. Only after that succeeds does the server fan the event out through Socket.IO. A socket can join a project room only after the server checks the user’s role and database scope: admins can join any project, project managers can join projects they own, and developers can join projects containing one of their assigned tasks. The REST activity endpoint applies the same scope and returns the newest 20 rows from PostgreSQL, so a reconnect or missed socket event is repaired from stored history rather than process memory. Admins also receive a global room event, while PM and developer personal rooms receive only activity relevant to their ownership or assignments. Notification rows are created alongside assignment and review transitions, and their unread count is pushed to the user room immediately. Access tokens stay in memory; refresh tokens rotate through an HttpOnly cookie and hashed database records. If I were taking this to production, I would split the cron worker from the API and add a Redis adapter for multi-instance Socket.IO before enabling horizontal autoscaling.
