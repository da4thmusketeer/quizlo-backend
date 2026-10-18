import { Router } from "express";
import {
  getQuizCategories,
  getAllQuizzes,
  createQuiz,
  createQuizWithAI,
  generateAIQuizPreview,
  startQuiz,
  completeQuiz,
  getQuizbyId,
  getQuizQuestions,
  submitAnswer,
  updateQuiz,
  deleteQuiz,
} from "../controllers/quiz.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createQuizSchema,
  createAIQuizSchema,
  generateAIQuizSchema,
  updateQuizSchema,
  submitAnswerSchema,
} from "../validators/quiz.validator.js";

const quizRouter = Router();

quizRouter.get("/all", verifyToken, getAllQuizzes);
quizRouter.get("/categories", verifyToken, getQuizCategories);
quizRouter.post("/create", verifyToken, validate(createQuizSchema), createQuiz);
quizRouter.post("/create-ai", verifyToken, validate(createAIQuizSchema), createQuizWithAI);
quizRouter.post("/generate-ai", verifyToken, validate(generateAIQuizSchema), generateAIQuizPreview);
quizRouter.get("/:id", verifyToken, getQuizbyId); // where :id is the quizId
quizRouter.get("/:id/questions", verifyToken, getQuizQuestions);
quizRouter.patch("/:id", verifyToken, validate(updateQuizSchema), updateQuiz); // Update quiz
quizRouter.delete("/:id", verifyToken, deleteQuiz); // Delete quiz
quizRouter.post("/:id/start", verifyToken, startQuiz); // where :id is the quizId
quizRouter.post(
  "/attempts/:attemptId/submit-answer",
  verifyToken,
  validate(submitAnswerSchema),
  submitAnswer,
); // where :attemptId is the attemptId
quizRouter.post("/attempts/:attemptId/complete", verifyToken, completeQuiz); // where :attemptId is the attemptId

export default quizRouter;
