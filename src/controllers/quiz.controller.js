import { prisma } from "../lib/prisma.js";
import { generateId } from "../utils/id.util.js";
import { getLevelFromXP, XP_REWARDS } from "../utils/xp.util.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../utils/error.util.js";
import { generateAIQuiz } from "../services/groq-quiz.service.js";

/**
 * Converts frontend question data into the answerOption rows to be stored.
 *
 * Text-based types (ShortAnswer, LongAnswer, FillInTheBlank) store their
 * answer in `q.correctAnswerText`, not inside `q.options`.
 * Numeric stores its answer in `q.correctAnswerNumeric`.
 * All other types (Mcq, TrueFalse, MultipleSelect, Matching, OrderSequencing)
 * use the standard `q.options` array.
 */
function buildAnswerOptions(q) {
  const TEXT_TYPES = ["ShortAnswer", "LongAnswer", "FillInTheBlank"];

  // ── Free-text answer types ────────────────────────────────────────────────
  if (TEXT_TYPES.includes(q.type)) {
    const answer = (q.correctAnswerText ?? "").trim();
    if (!answer) return []; // nothing to store yet (e.g. draft)
    return [{ id: generateId("opt"), text: answer, isCorrect: true, matchText: null, order: 1 }];
  }

  // ── Numeric answer ───────────────────────────────────────────────────────
  if (q.type === "Numeric") {
    const answer =
      q.correctAnswerNumeric !== undefined &&
      q.correctAnswerNumeric !== null &&
      q.correctAnswerNumeric !== ""
        ? String(q.correctAnswerNumeric)
        : null;
    if (!answer) return [];
    return [{ id: generateId("opt"), text: answer, isCorrect: true, matchText: null, order: 1 }];
  }

  // ── All other types (options array) ──────────────────────────────────────
  return (q.options ?? []).map((opt, idx) => ({
    id: generateId("opt"),
    text: opt.text ?? "",
    isCorrect: ["Matching", "OrderSequencing"].includes(q.type) ? true : !!opt.isCorrect,
    matchText: opt.matchText ?? null,
    order: opt.order ?? idx + 1,
  }));
}

/**
 * Create a new quiz manually
 * @route POST /quiz/create
 */
const createQuiz = asyncHandler(async (req, res) => {
  const payload = req.body;
  const creatorId = payload.creatorId || req.user?.id;

  console.log("Backend: Received createQuiz request");
  console.log("Backend: Derived creatorId:", creatorId);

  if (!creatorId) {
    throw new BadRequestError("Creator ID is required");
  }

  // Award XP to creator when publishing a real quiz (not a draft)

  const quiz = await prisma.quiz.create({
    data: {
      id: generateId("quiz"),
      title: payload.title,
      description: payload.description,
      difficulty: payload.difficulty,
      timeAllocated: payload.timeAllocated,
      isPrivate: payload.isPrivate,
      isDraft: payload.isDraft,
      creationMode: payload.creationMode,
      plays: payload.plays || 0,
      coverPicture: payload.coverPicture,
      creatorId: creatorId,
      categoryId: payload.categoryId,
      questions: {
        create:
            payload.questions?.map((q, qIndex) => ({
              id: generateId("ques"),
              text: q.text,
              type: q.type || "Mcq",
              explanation: q.explanation,
              media: q.media || [],
              order: qIndex + 1,
              answerOptions: {
                create: buildAnswerOptions(q),
              },
            })) || [],
      },
    },
    include: {
      questions: {
        include: {
          answerOptions: true,
        },
        orderBy: { order: "asc" },
      },
      category: true,
    },
  });

  console.log("Backend: Quiz created successfully:", quiz.id);

  if (!payload.isDraft) {
    const creator = await prisma.user.findUnique({ where: { id: creatorId } });
    if (creator) {
      const newTotalXP = creator.xp + XP_REWARDS.CREATE_QUIZ;
      const newLevel = getLevelFromXP(newTotalXP);
      await prisma.user.update({
        where: { id: creatorId },
        data: { xp: newTotalXP, level: newLevel },
      });
    }
  }

  return res.status(201).json({
    success: true,
    message: "Quiz created successfully",
    data: quiz,
  });
});

/**
 * Generate AI quiz content preview without persisting
 * @route POST /quiz/generate-ai
 */
const generateAIQuizPreview = asyncHandler(async (req, res) => {
  const { topic, difficulty, numberOfQuestions } = req.body;

  if (!topic || !topic.trim()) {
    throw new BadRequestError("Topic is required");
  }

  const generatedQuiz = await generateAIQuiz({
    topic: topic.trim(),
    difficulty: difficulty || "Medium",
    numberOfQuestions: numberOfQuestions ? Number(numberOfQuestions) : 5,
  });

  return res.status(200).json({
    success: true,
    message: "AI Quiz generated successfully",
    data: generatedQuiz,
  });
});

/**
 * Create a new quiz with AI and persist to database
 * @route POST /quiz/create-ai
 */
const createQuizWithAI = asyncHandler(async (req, res) => {
  const payload = req.body;
  const creatorId = payload.creatorId || req.user?.id;

  if (!creatorId) {
    throw new BadRequestError("Creator ID is required");
  }

  if (!payload.topic || !payload.topic.trim()) {
    throw new BadRequestError("Topic is required");
  }

  if (!payload.categoryId) {
    throw new BadRequestError("Category ID is required");
  }

  const categoryExists = await prisma.category.findUnique({
    where: { id: payload.categoryId },
  });

  if (!categoryExists) {
    throw new NotFoundError("Category not found");
  }

  const numQuestions = payload.numberOfQuestions
    ? Number(payload.numberOfQuestions)
    : 5;
  const difficulty = payload.difficulty || "Medium";

  const aiGeneratedQuiz = await generateAIQuiz({
    topic: payload.topic.trim(),
    difficulty,
    numberOfQuestions: numQuestions,
  });

  const title = payload.title?.trim() || aiGeneratedQuiz.title;
  const description =
    payload.description !== undefined
      ? payload.description
      : `AI-generated quiz about ${payload.topic.trim()}`;
  const isDraft = payload.isDraft ?? false;

  const quiz = await prisma.quiz.create({
    data: {
      id: generateId("quiz"),
      title,
      description,
      difficulty,
      timeAllocated: payload.timeAllocated,
      isPrivate: payload.isPrivate ?? false,
      isDraft,
      creationMode: "Ai",
      plays: payload.plays || 0,
      coverPicture: payload.coverPicture,
      creatorId,
      categoryId: payload.categoryId,
      questions: {
        create: aiGeneratedQuiz.questions.map((q, qIndex) => ({
          id: generateId("ques"),
          text: q.question,
          type: "Mcq",
          explanation: q.explanation || null,
          media: [],
          order: qIndex + 1,
          answerOptions: {
            create: q.options.map((optText, optIndex) => ({
              id: generateId("opt"),
              text: optText,
              isCorrect: optIndex === q.correctAnswer,
              matchText: null,
              order: optIndex + 1,
            })),
          },
        })),
      },
    },
    include: {
      questions: {
        include: {
          answerOptions: true,
        },
        orderBy: { order: "asc" },
      },
      category: true,
    },
  });

  if (!isDraft) {
    const creator = await prisma.user.findUnique({ where: { id: creatorId } });
    if (creator) {
      const newTotalXP = creator.xp + XP_REWARDS.CREATE_QUIZ;
      const newLevel = getLevelFromXP(newTotalXP);
      await prisma.user.update({
        where: { id: creatorId },
        data: { xp: newTotalXP, level: newLevel },
      });
    }
  }

  return res.status(201).json({
    success: true,
    message: "AI Quiz created successfully",
    data: quiz,
  });
});

/**
 * Update an existing quiz (metadata, settings, and/or questions)
 * @route PATCH /quiz/:id
 */
const updateQuiz = asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;
  const { questions, deletedQuestionIds, ...rawData } = req.body;

  if (!quizId) {
    throw new BadRequestError("Quiz ID is required.");
  }

  // 1. Ownership & Existence Check
  const existingQuiz = await prisma.quiz.findUnique({ where: { id: quizId } });

  if (!existingQuiz) {
    throw new NotFoundError("Quiz not found.");
  }

  if (existingQuiz.creatorId !== userId) {
    throw new ForbiddenError("You are not authorized to edit this quiz.");
  }

  // 2. Validate category if categoryId is updated
  if (rawData.categoryId && rawData.categoryId !== existingQuiz.categoryId) {
    const categoryExists = await prisma.category.findUnique({
      where: { id: rawData.categoryId },
    });

    if (!categoryExists) {
      throw new NotFoundError("Category not found.");
    }
  }

  // 3. Strip restricted fields from the top-level update payload
  [
    "id",
    "plays",
    "rating",
    "createdAt",
    "creatorId",
    "creationMode",
    "updatedAt",
  ].forEach((field) => delete rawData[field]);

  // Clean title if passed
  if (rawData.title !== undefined) {
    if (!rawData.title || !rawData.title.trim()) {
      throw new BadRequestError("Title cannot be empty.");
    }
    rawData.title = rawData.title.trim();
  }

  // Coerce timeAllocated if passed
  if (rawData.timeAllocated !== undefined) {
    rawData.timeAllocated =
      rawData.timeAllocated !== null ? Number(rawData.timeAllocated) : null;
  }

  // Coerce booleans if passed
  if (rawData.isPrivate !== undefined) {
    rawData.isPrivate = Boolean(rawData.isPrivate);
  }
  if (rawData.isDraft !== undefined) {
    rawData.isDraft = Boolean(rawData.isDraft);
  }

  // 4. Interactive transaction with a 30s timeout
  await prisma.$transaction(
    async (tx) => {
      // A. Update top-level quiz fields if any provided
      if (Object.keys(rawData).length > 0) {
        await tx.quiz.update({ where: { id: quizId }, data: rawData });
      }

      // B. Delete removed questions (cascade removes their answerOptions)
      if (Array.isArray(deletedQuestionIds) && deletedQuestionIds.length > 0) {
        await tx.question.deleteMany({
          where: { id: { in: deletedQuestionIds }, quizId },
        });
      }

      // C. Process each question
      if (Array.isArray(questions)) {
        for (const [qIndex, q] of questions.entries()) {
          if (q.id) {
            // Existing question
            await tx.question.update({
              where: { id: q.id },
              data: {
                text: q.text,
                type: q.type,
                explanation: q.explanation ?? null,
                media: q.media ?? [],
                order: qIndex + 1,
              },
            });

            // Wipe old options and bulk-insert new ones
            await tx.answerOption.deleteMany({ where: { questionId: q.id } });

            const builtOptions = buildAnswerOptions(q);
            if (builtOptions.length > 0) {
              await tx.answerOption.createMany({
                data: builtOptions.map((opt) => ({
                  questionId: q.id,
                  ...opt,
                })),
              });
            }
          } else {
            // New question
            await tx.question.create({
              data: {
                id: generateId("ques"),
                quizId,
                text: q.text,
                type: q.type ?? "Mcq",
                explanation: q.explanation ?? null,
                media: q.media ?? [],
                order: qIndex + 1,
                answerOptions: {
                  create: buildAnswerOptions(q),
                },
              },
            });
          }
        }
      }
    },
    { timeout: 30_000 },
  );

  // 5. Award XP if publishing a quiz for the first time (transitioning from draft to published)
  if (existingQuiz.isDraft && rawData.isDraft === false) {
    const creator = await prisma.user.findUnique({ where: { id: userId } });
    if (creator) {
      const newTotalXP = creator.xp + XP_REWARDS.CREATE_QUIZ;
      const newLevel = getLevelFromXP(newTotalXP);
      await prisma.user.update({
        where: { id: userId },
        data: { xp: newTotalXP, level: newLevel },
      });
    }
  }

  // 6. Return updated quiz with questions, category, creator, and counts
  const updatedQuiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      category: true,
      creator: {
        select: {
          username: true,
          profilePicture: true,
        },
      },
      _count: {
        select: {
          questions: true,
          ratings: true,
        },
      },
      questions: {
        include: { answerOptions: true },
        orderBy: { order: "asc" },
      },
    },
  });

  return res.status(200).json({
    success: true,
    message: "Quiz updated successfully.",
    data: updatedQuiz,
  });
});

/**
 * Delete a quiz
 * @route DELETE /quiz/:id
 */
const deleteQuiz = asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;

  // 1. Ownership & Existence Check
  const existingQuiz = await prisma.quiz.findUnique({ where: { id: quizId } });

  if (!existingQuiz) {
    throw new NotFoundError("Quiz not found.");
  }

  if (existingQuiz.creatorId !== userId) {
    throw new ForbiddenError("You are not authorized to delete this quiz.");
  }

  // 2. Perform deletion
  await prisma.quiz.delete({
    where: { id: quizId },
  });

  return res.status(200).json({
    success: true,
    message: "Quiz deleted successfully.",
  });
});

/**
 * Get quiz questions
 * @route GET /quiz/:id/questions
 */
const getQuizQuestions = asyncHandler(async (req, res) => {
  const quizId = req.params.id;

  if (!quizId) {
    throw new BadRequestError("Quiz ID is required.");
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        include: {
          answerOptions: true,
        },
      },
    },
  });

  if (!quiz) {
    throw new NotFoundError("Quiz not found.");
  }

  return res.status(200).json({
    success: true,
    message: "Quiz questions fetched successfully.",
    data: quiz.questions,
  });
});

/**
 * Get quiz by ID
 * @route GET /quiz/:id
 */
const getQuizbyId = asyncHandler(async (req, res) => {
  const quiz_id = req.params.id;

  if (!quiz_id) {
    throw new BadRequestError("Quiz ID is required.");
  }

  const quiz = await prisma.quiz.findUnique({
    where: { id: quiz_id },
    include: {
      questions: {
        include: {
          answerOptions: true,
        },
      },
      creator: {
        select: {
          username: true,
          profilePicture: true,
        },
      },
      _count: {
        select: {
          questions: true,
          ratings: true,
        },
      },
      category: true,
    },
  });

  if (!quiz) {
    throw new NotFoundError("Quiz not found.");
  }

  return res.status(200).json({
    success: true,
    message: "Quiz has been found.",
    data: quiz,
  });
});

/**
 * Get all published public quizzes
 * @route GET /quiz/all
 */
const getAllQuizzes = asyncHandler(async (req, res) => {
  const quizzes = await prisma.quiz.findMany({
    include: {
      creator: {
        select: {
          username: true,
          profilePicture: true,
        },
      },
      category: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          questions: true,
          ratings: true,
        },
      },
    },
  });

  const filteredQuizzes = quizzes.filter(
    (quiz) => quiz.status !== "draft" && quiz.isPrivate !== true,
  );

  return res.status(200).json({
    success: true,
    data: filteredQuizzes,
    count: filteredQuizzes.length,
  });
});

/**
 * Get all quiz categories
 * @route GET /quiz/categories
 */
const getQuizCategories = asyncHandler(async (req, res) => {
  const categories = await prisma.category.findMany();
  return res.status(200).json({
    success: true,
    data: categories,
    count: categories.length,
  });
});

/**
 * Start a quiz session
 * @route POST /quiz/:id/start
 */
const startQuiz = asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const userId = req.user.id;

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        include: {
          answerOptions: true,
        },
      },
    },
  });

  if (!quiz) {
    throw new NotFoundError("Quiz not found");
  }

  const attempt = await prisma.quizAttempt.create({
    data: {
      id: generateId("attm"),
      userId: userId,
      quizId: quizId,
      totalQuestions: quiz.questions.length,
      accuracy: 0,
      score: 0,
    },
  });

  const sanitizedQuestions = quiz.questions.map((question) => ({
    ...question,
    answerOptions: question.answerOptions.map((option) => {
      const { isCorrect, ...publicOption } = option;
      return publicOption;
    }),
  }));

  return res.status(200).json({
    success: true,
    message: "Quiz session started successfully",
    data: {
      attemptId: attempt.id,
      quizTitle: quiz.title,
      timeAllocated: quiz.timeAllocated,
      questions: sanitizedQuestions,
    },
  });
});

/**
 * Submit an answer for a question in a quiz attempt
 * @route POST /quiz/attempts/:attemptId/submit-answer
 */
const submitAnswer = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const {
    questionId,
    selectedOptionId,
    selectedOptionIds,
    textResponse,
    responseJson,
    timeSpent,
  } = req.body;
  const userId = req.user.id;

  // 1. Verify Attempt Ownership and Status
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: { quiz: true },
  });

  if (!attempt || attempt.userId !== userId) {
    throw new ForbiddenError("Unauthorized attempt access");
  }

  if (attempt.completedAt) {
    throw new BadRequestError("This attempt has already been completed");
  }

  // 2. Check if this question has already been answered
  const existingAnswer = await prisma.attemptAnswer.findUnique({
    where: { attemptId_questionId: { attemptId, questionId } },
  });

  if (existingAnswer) {
    throw new BadRequestError("Question already answered");
  }

  // 3. Fetch Question and its AnswerOptions
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answerOptions: true },
  });

  if (!question) {
    throw new NotFoundError("Question not found");
  }

  // 4. Verify the Answer based on Question Type
  let isCorrect = false;
  let correctData = null;

  switch (question.type) {
    case "Mcq":
    case "TrueFalse": {
      const correctOption = question.answerOptions.find((o) => o.isCorrect);
      isCorrect = correctOption?.id === selectedOptionId;
      correctData = correctOption?.id;
      break;
    }

    case "MultipleSelect": {
      const correctOptionIds = question.answerOptions
        .filter((o) => o.isCorrect)
        .map((o) => o.id)
        .sort();

      const userOptionIds = (selectedOptionIds || []).sort();

      isCorrect =
        JSON.stringify(correctOptionIds) === JSON.stringify(userOptionIds);
      correctData = correctOptionIds;
      break;
    }

    case "ShortAnswer":
    case "FillInTheBlank":
    case "Numeric": {
      const correctOption = question.answerOptions.find((o) => o.isCorrect);
      const userResponse = (textResponse || "").trim().toLowerCase();
      const dbResponse = (correctOption?.text || "").trim().toLowerCase();

      isCorrect = userResponse === dbResponse;
      correctData = correctOption?.text;
      break;
    }

    case "Matching": {
      isCorrect = question.answerOptions.every((option) => {
        const userMatch = (responseJson || {})[option.id];
        return userMatch === option.matchText;
      });
      correctData = question.answerOptions.reduce((acc, opt) => {
        acc[opt.id] = opt.matchText;
        return acc;
      }, {});
      break;
    }

    case "OrderSequencing": {
      const correctOrderIds = [...question.answerOptions]
        .sort((a, b) => a.order - b.order)
        .map((o) => o.id);

      isCorrect =
        JSON.stringify(correctOrderIds) === JSON.stringify(selectedOptionIds);
      correctData = correctOrderIds;
      break;
    }

    case "LongAnswer": {
      isCorrect = !!(textResponse && textResponse.trim().length > 10);
      break;
    }

    default:
      throw new BadRequestError("Unknown question type");
  }

  // 5. Calculate Points & Speed Bonus
  let pointsEarned = 0;
  if (isCorrect) {
    const basePoints = 100;
    const speedBonus = timeSpent < 5 ? 50 : 0;
    pointsEarned = basePoints + speedBonus;
  }

  // 6. Update Database (Transactionally)
  await prisma.$transaction([
    prisma.attemptAnswer.create({
      data: {
        id: generateId("ansr"),
        attemptId,
        questionId,
        selectedOptionId:
          question.type === "Mcq" || question.type === "TrueFalse"
            ? selectedOptionId
            : null,
        selectedOptionIds:
          question.type === "MultipleSelect" ||
          question.type === "OrderSequencing"
            ? selectedOptionIds
            : [],
        textResponse:
          question.type === "ShortAnswer" ||
          question.type === "FillInTheBlank" ||
          question.type === "Numeric" ||
          question.type === "LongAnswer"
            ? textResponse
            : null,
        responseJson:
          question.type === "Matching" ? responseJson : undefined,
        isCorrect,
      },
    }),
    prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        score: { increment: pointsEarned },
      },
    }),
  ]);

  // 7. Return Feedback
  return res.status(200).json({
    success: true,
    data: {
      isCorrect,
      pointsEarned,
      correctData: isCorrect ? null : correctData,
    },
  });
});

/**
 * Complete a quiz attempt and calculate stats/rewards
 * @route POST /quiz/attempts/:attemptId/complete
 */
const completeQuiz = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const userId = req.user.id;

  // 1. Fetch Attempt with all answers and the original Quiz difficulty
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: {
      quiz: {
        include: {
          questions: {
            include: { answerOptions: true },
          },
        },
      },
      answers: true,
    },
  });

  if (!attempt) {
    throw new NotFoundError("Quiz attempt not found.");
  }

  if (attempt.userId !== userId) {
    throw new ForbiddenError("Unauthorized attempt completion.");
  }

  if (attempt.completedAt) {
    throw new BadRequestError("This quiz attempt has already been completed.");
  }

  // 2. CALCULATE FINAL STATS
  const correctAnswersCount = attempt.answers.filter((a) => a.isCorrect).length;
  const totalQuestions = attempt.totalQuestions;

  // Build master list of correct answers
  const correctAnswers = attempt.quiz.questions.map((q) => {
    let correctData = null;
    switch (q.type) {
      case "Mcq":
      case "TrueFalse":
        correctData = q.answerOptions[0]?.id;
        break;
      case "MultipleSelect":
        correctData = q.answerOptions.map((o) => o.id).sort();
        break;
      case "ShortAnswer":
      case "FillInTheBlank":
      case "Numeric":
        correctData = q.answerOptions[0]?.text;
        break;
      case "Matching":
        correctData = q.answerOptions.reduce((acc, opt) => {
          acc[opt.id] = opt.matchText;
          return acc;
        }, {});
        break;
      case "OrderSequencing":
        correctData = [...q.answerOptions]
          .sort((a, b) => a.order - b.order)
          .map((o) => o.id);
        break;
      default:
        correctData = null;
    }
    return { questionId: q.id, type: q.type, correctData };
  });

  // Score as a percentage: (correct / total) * 100
  const scorePercentage = Math.round(
    (correctAnswersCount / totalQuestions) * 100,
  );

  // 4. CALCULATE XP EARNED
  let xpEarned = XP_REWARDS.COMPLETE_QUIZ;
  xpEarned += correctAnswersCount * XP_REWARDS.CORRECT_ANSWER;

  if (correctAnswersCount === totalQuestions) {
    xpEarned += XP_REWARDS.PERFECT_SCORE_BONUS;
  }

  const previousAttemptCount = await prisma.quizAttempt.count({
    where: {
      userId,
      quizId: attempt.quizId,
      completedAt: { not: null },
      id: { not: attemptId },
    },
  });
  if (previousAttemptCount === 0) {
    xpEarned += XP_REWARDS.FIRST_TIME_PLAY;
  }

  const difficultyMultipliers = { Easy: 1, Medium: 1.5, Hard: 2 };
  const multiplier = difficultyMultipliers[attempt.quiz.difficulty] || 1;
  const totalXPEarned = Math.round(xpEarned * multiplier);

  // 5. GAMIFICATION UPDATES (User Profile)
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const newTotalXP = user.xp + totalXPEarned;
  const newLevel = getLevelFromXP(newTotalXP);
  const didLevelUp = newLevel > user.level;
  const updatedStreak = user.streak + 1;

  // 6. UPDATE EVERYTHING TRANSACTIONALLY
  await prisma.$transaction([
    prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        accuracy: scorePercentage,
        xpEarned: totalXPEarned,
        completedAt: new Date(),
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        xp: newTotalXP,
        level: newLevel,
        streak: updatedStreak,
      },
    }),
    prisma.quiz.update({
      where: { id: attempt.quizId },
      data: { plays: { increment: 1 } },
    }),
  ]);

  // 7. RESPONSE
  console.log("Quiz summary data sent:", {
    score: scorePercentage,
    questionsAnsweredCorrectly: correctAnswersCount,
    totalQuestions,
    xpEarned: totalXPEarned,
    levelUp: didLevelUp,
    correctAnswers,
    newLevel,
  });
  return res.status(200).json({
    success: true,
    message: "Quiz completed! Great job.",
    data: {
      score: scorePercentage,
      questionsAnsweredCorrectly: correctAnswersCount,
      totalQuestions,
      xpEarned: totalXPEarned,
      levelUp: didLevelUp,
      correctAnswers,
      newLevel,
    },
  });
});

export {
  getQuizCategories,
  getAllQuizzes,
  createQuiz,
  createQuizWithAI,
  generateAIQuizPreview,
  startQuiz,
  getQuizbyId,
  submitAnswer,
  completeQuiz,
  getQuizQuestions,
  updateQuiz,
  deleteQuiz,
};
