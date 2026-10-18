import { z } from "zod";

export const createQuizSchema = z.object({
  title: z.string().min(1, "Title is required"),
  categoryId: z.string().min(1, "Category ID is required"),
  creatorId: z.string().optional(),
  description: z.string().optional().nullable(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  timeAllocated: z.number().optional().nullable(),
  isPrivate: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  creationMode: z.enum(["Manual", "Ai", "manual", "ai"]).optional(),
  plays: z.number().optional(),
  coverPicture: z.string().optional().nullable(),
  questions: z.array(z.any()).optional(),
});

export const updateQuizSchema = z.object({
  title: z.string().min(1, "Title cannot be empty").optional(),
  categoryId: z.string().optional(),
  description: z.string().optional().nullable(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
  timeAllocated: z.coerce.number().optional().nullable(),
  isPrivate: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  creationMode: z.enum(["Manual", "Ai", "manual", "ai"]).optional(),
  coverPicture: z.string().optional().nullable(),
  questions: z.array(z.any()).optional(),
  deletedQuestionIds: z.array(z.string()).optional(),
});

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1, "Question ID is required"),
  selectedOptionId: z.string().optional().nullable(),
  selectedOptionIds: z.array(z.string()).optional(),
  textResponse: z.string().optional().nullable(),
  responseJson: z.any().optional(),
  timeToAnswer: z.number().optional().nullable(),
});




export const completeQuizSchema = z.object({}).passthrough().optional();

export const generateAIQuizSchema = z.object({
  topic: z.string().min(1, "Topic is required"),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional().default("Medium"),
  numberOfQuestions: z.coerce
    .number()
    .int()
    .min(1, "At least 1 question is required")
    .max(50, "Maximum 50 questions allowed")
    .optional()
    .default(5),
});

export const createAIQuizSchema = z.object({
  title: z.string({ required_error: "Title is required" }).min(1, "Title is required"),
  topic: z.string({ required_error: "Topic is required" }).min(1, "Topic is required"),
  categoryId: z.string({ required_error: "Category ID is required" }).min(1, "Category ID is required"),
  difficulty: z.enum(["Easy", "Medium", "Hard"], {
    required_error: "Difficulty is required",
    invalid_type_error: "Difficulty must be Easy, Medium, or Hard",
  }),
  timeAllocated: z.coerce.number({
    required_error: "Time allocated is required",
    invalid_type_error: "Time allocated must be a number",
  }),
  isPrivate: z.boolean({
    required_error: "isPrivate is required",
    invalid_type_error: "isPrivate must be a boolean",
  }),
  numberOfQuestions: z.coerce
    .number()
    .int()
    .min(1, "At least 1 question is required")
    .max(50, "Maximum 50 questions allowed")
    .optional()
    .default(5),
  creatorId: z.string().optional(),
  description: z.string().optional().nullable(),
  isDraft: z.boolean().optional().default(false),
  creationMode: z.enum(["Manual", "Ai", "manual", "ai"]).optional().default("Ai"),
  plays: z.number().optional(),
  coverPicture: z.string().optional().nullable(),
});
