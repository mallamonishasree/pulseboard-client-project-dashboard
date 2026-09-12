import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (handler: RequestHandler): RequestHandler => {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
};

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

export const errorHandler: ErrorRequestHandler = (error, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.flatten() } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    response.status(409).json({ error: { code: "DATABASE_CONFLICT", message: "The request conflicts with existing data" } });
    return;
  }
  console.error(error);
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
};
