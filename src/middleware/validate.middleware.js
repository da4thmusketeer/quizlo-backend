import { ZodError } from "zod";

/**
 * Middleware factory that validates incoming request data against a Zod schema.
 * @param {import("zod").ZodSchema} schema - Zod schema to validate against
 * @param {"body" | "query" | "params"} source - The request property to validate
 */
export const validate = (schema, source = "body") => {
  return async (req, res, next) => {
    try {
      const parsed = await schema.parseAsync(req[source]);
      req[source] = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues
          ? error.issues.map((i) => i.message)
          : error.errors?.map((i) => i.message) || [];
        const primaryMessage = errorMessages[0] || "Validation failed";

        return res.status(400).json({
          success: false,
          error: primaryMessage,
          message: primaryMessage,
          errors: error.format ? error.format() : error.issues || error.errors,
        });
      }
      next(error);
    }
  };
};
