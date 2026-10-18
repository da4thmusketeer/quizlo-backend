import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email("Invalid email format"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const googleAuthSchema = z
  .object({
    idToken: z.string().optional(),
    token: z.string().optional(),
    credential: z.string().optional(),
  })
  .refine((data) => Boolean(data.idToken || data.token || data.credential), {
    message: "Google ID token or credential is required",
  });
