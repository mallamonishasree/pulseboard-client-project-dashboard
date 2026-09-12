import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { authRouter, apiRouter } from "./routes.js";
import { env } from "./env.js";
import { errorHandler, notFound } from "./errors.js";
import { setupSocket } from "./socket.js";
import { startOverdueJob } from "./jobs.js";

const app = express();
const httpServer = http.createServer(app);
const currentDir = path.dirname(fileURLToPath(import.meta.url));

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.use("/api/auth", authRouter);
app.use("/api", apiRouter);

const clientDist = path.resolve(currentDir, "../../dist/client");
app.use(express.static(clientDist));
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api") || request.path === "/health") return next();
  response.sendFile(path.join(clientDist, "index.html"));
});
app.use(notFound);
app.use(errorHandler);

setupSocket(httpServer);
startOverdueJob();

httpServer.listen(env.PORT, () => console.log(`Pulseboard API listening on http://localhost:${env.PORT}`));
