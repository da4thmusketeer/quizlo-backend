import { AppError } from "../utils/error.util.js";
import { ZodError } from "zod";

export function errorHandler(err, req, res, next) {
  console.error("Unhandled Error:", err);

  // AppError / Custom operational errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Zod Validation Error
  if (err instanceof ZodError) {
    const errorMessages = err.issues
      ? err.issues.map((i) => i.message)
      : err.errors?.map((e) => e.message) || [];
    const primaryMessage = errorMessages[0] || "Validation error";

    return res.status(400).json({
      success: false,
      error: primaryMessage,
      message: primaryMessage,
      errors: err.format ? err.format() : err.issues || err.errors,
    });
  }

  // Prisma Unique Constraint Error
  if (err?.code === "P2002") {
    return res.status(409).json({
      success: false,
      error: "A record with this information already exists.",
      message: "A record with this information already exists.",
    });
  }

  // Prisma Record Not Found Error
  if (err?.code === "P2025") {
    return res.status(404).json({
      success: false,
      error: "Requested record was not found.",
      message: "Requested record was not found.",
    });
  }

  // JWT Errors
  if (err?.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      error: "Invalid token.",
      message: "Invalid token.",
    });
  }

  if (err?.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      error: "Token has expired.",
      message: "Token has expired.",
    });
  }

  // Default server error
  const statusCode = err?.statusCode || 500;
  const message = err?.message || "Internal server error";

  return res.status(statusCode).json({
    success: false,
    error: message,
    message: message,
  });
}
