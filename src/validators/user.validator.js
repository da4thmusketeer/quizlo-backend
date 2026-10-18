import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  bio: z.string().max(200, "Bio cannot exceed 200 characters").optional().nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export const changeUsernameSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username cannot exceed 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
});

export const changeEmailSchema = z.object({
  password: z.string().min(1, "Password is required"),
  newEmail: z.string().email("Invalid email address"),
});

export const verifyEmailChangeSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});

export const rateQuizSchema = z.object({
  quizId: z.string().min(1, "Quiz ID is required"),
  rating: z.number().int().min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5"),
  comment: z.string().optional().nullable(),
});
