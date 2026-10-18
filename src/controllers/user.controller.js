import { prisma } from "../lib/prisma.js";
import { hashPassword, comparePassword } from "../utils/password.util.js";
import { cloudinary } from "../lib/cloudinary.js";
import { getLevelFromXP, getXPProgress, XP_REWARDS } from "../utils/xp.util.js";
import {
  sendNewEmailVerification,
  sendEmailChangeNotice,
  sendEmailChangeConfirmation,
} from "../services/email.service.js";
import crypto from "crypto";
import "dotenv/config";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from "../utils/error.util.js";

/**
 * Retrieve the authenticated user's profile
 * @route GET /user/me
 */
const getUser = asyncHandler(async (req, res) => {
  console.log("User ID from token:", req.user.id);
  const user = await prisma.user.findUnique({
    where: {
      id: req.user.id,
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // ── Daily Login XP (once per calendar day) ──────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0); // normalize to midnight
  const lastLogin = user.lastLoginDate ? new Date(user.lastLoginDate) : null;
  const alreadyLoggedInToday = lastLogin && lastLogin >= today;

  let dailyLoginXP = 0;
  if (!alreadyLoggedInToday) {
    dailyLoginXP = XP_REWARDS.DAILY_LOGIN;
    const newTotalXP = user.xp + dailyLoginXP;
    const newLevel = getLevelFromXP(newTotalXP);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { xp: newTotalXP, level: newLevel, lastLoginDate: new Date() },
    });
    // Reflect changes in the user object we're about to return
    user.xp = updated.xp;
    user.level = updated.level;
    user.lastLoginDate = updated.lastLoginDate;
  }
  // ────────────────────────────────────────────────────────────────────────

  delete user.password;

  return res.status(200).json({
    success: true,
    data: user,
    dailyLoginXP, // 0 if already logged in today, 15 if first login of the day
  });
});

/**
 * Retrieve any user by their ID
 * @route GET /user/profile/:id
 */
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  delete user.password;

  return res.status(200).json({
    success: true,
    data: user,
  });
});

/**
 * Update the authenticated user's profile
 * @route PATCH /user/profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  console.log("Update request from user:", req.user.id);
  console.log("Update data:", req.body);

  // Define fields that cannot be updated (password has separate endpoint)
  const protectedFields = ["id", "password", "createdAt", "updatedAt"];

  // Create a sanitized update object
  const updateData = { ...req.body };

  // Remove protected fields
  protectedFields.forEach((field) => delete updateData[field]);

  // Validate that there's actually data to update
  if (Object.keys(updateData).length === 0) {
    throw new BadRequestError("No valid fields to update");
  }

  // Update the user
  const user = await prisma.user.update({
    where: {
      id: req.user.id,
    },
    data: updateData,
  });

  // Remove password from response
  delete user.password;

  return res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: user,
  });
});

/**
 * Change the authenticated user's password
 * @route PATCH /user/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (currentPassword === newPassword) {
    throw new BadRequestError("Current password and new password cannot be the same");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: req.user.id,
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const isPasswordValid = await comparePassword(
    currentPassword,
    user.password,
  );

  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid current password");
  }

  const hashednewPassword = await hashPassword(newPassword);

  const updatedUser = await prisma.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      password: hashednewPassword,
    },
  });

  delete updatedUser.password;

  return res.status(200).json({
    success: true,
    message: "Password changed successfully",
    data: updatedUser,
  });
});

/**
 * Change username for the authenticated user
 * @route PATCH /user/change-username
 */
const changeUsername = asyncHandler(async (req, res) => {
  const { username } = req.body;

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // Check if username already exists
  const existingUser = await prisma.user.findUnique({
    where: { username },
  });

  if (existingUser) {
    throw new ConflictError("Username already exists");
  }

  const updatedUser = await prisma.user.update({
    where: { id: req.user.id },
    data: { username },
  });

  delete updatedUser.password;

  return res.status(200).json({
    success: true,
    message: "Username changed successfully",
    data: updatedUser,
  });
});

/**
 * Step 1 – Initiate an email change.
 * Validates the user's password, stages the new address, and sends:
 *   • A verification link to the NEW email
 *   • A security notice to the OLD email
 * @route PATCH /user/change-email
 */
const changeEmail = asyncHandler(async (req, res) => {
  const { newEmail, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // Confirm the request is coming from the real owner
  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid password");
  }

  // Reject if they're requesting the same address they already have
  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    throw new BadRequestError("New email is the same as your current email");
  }

  // Reject if the new address is already taken by another account
  const emailTaken = await prisma.user.findFirst({
    where: {
      email: { equals: newEmail, mode: "insensitive" },
      id: { not: req.user.id },
    },
  });
  if (emailTaken) {
    throw new ConflictError("That email address is already in use");
  }

  // Generate a secure, time-limited token (expires in 15 minutes)
  const token = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 15 * 60 * 1000);

  // Stage the pending change — do NOT touch user.email yet
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      pendingEmail: newEmail,
      emailChangeToken: token,
      emailChangeExpiry: expiry,
    },
  });

  const verificationURL = `${process.env.CLIENT_URL || process.env.FRONTEND_URL}/settings/verify-email-change?token=${token}`;

  // Fire both emails concurrently (non-blocking to the response)
  await Promise.allSettled([
    sendNewEmailVerification(newEmail, verificationURL),
    sendEmailChangeNotice(user.email, newEmail),
  ]);

  return res.status(200).json({
    success: true,
    message:
      "Verification email sent. Please check your new inbox — the link expires in 15 minutes.",
  });
});

/**
 * Step 2 – Verify the email change token and commit the swap.
 * Replaces the primary email with the verified pending email and
 * notifies both the new and the old address.
 * @route POST /user/verify-email-change
 */
const verifyEmailChange = asyncHandler(async (req, res) => {
  const { token } = req.body;

  // Find the user who owns this token (no auth middleware needed —
  // the token itself is the proof of identity)
  const user = await prisma.user.findFirst({
    where: {
      emailChangeToken: token,
      emailChangeExpiry: { gt: new Date() }, // not expired
    },
  });

  if (!user) {
    throw new BadRequestError("Invalid or expired verification token");
  }

  const oldEmail = user.email;
  const newEmail = user.pendingEmail;

  // Commit the swap and clear all pending-change fields atomically
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: newEmail,
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeExpiry: null,
    },
  });

  delete updatedUser.password;

  // Send success notifications to both addresses
  await Promise.allSettled([
    sendEmailChangeConfirmation(newEmail, true), // new address
    sendEmailChangeConfirmation(oldEmail, false), // old address
  ]);

  return res.status(200).json({
    success: true,
    message: "Email address updated successfully",
    data: updatedUser,
  });
});

/**
 * Upload a profile picture for the authenticated user
 * @route PATCH /user/profile-picture
 */
const uploadProfilePicture = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new BadRequestError("No image file provided");
  }

  // Upload buffer to Cloudinary using a stream
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "quizlo/profile-pictures",
        public_id: `user_${req.user.id}`,
        overwrite: true,
        transformation: [
          { width: 400, height: 400, crop: "fill", gravity: "face" },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
    uploadStream.end(req.file.buffer);
  });

  // Save the URL to the database
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePicture: result.secure_url },
  });

  delete user.password;

  return res.status(200).json({
    success: true,
    message: "Profile picture updated successfully",
    data: user,
  });
});

/**
 * Delete profile picture for the authenticated user
 * @route DELETE /user/profile-picture
 */
const deleteProfilePicture = asyncHandler(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { profilePicture: null },
  });

  delete user.password;

  return res.status(200).json({
    success: true,
    message: "Profile picture deleted successfully",
    data: user,
  });
});

/**
 * Retrieve quizzes created by the authenticated user
 * @route GET /user/quizzes
 */
const getUserQuizzes = asyncHandler(async (req, res) => {
  const quizzes = await prisma.quiz.findMany({
    where: {
      creatorId: req.user.id,
    },
    include: {
      category: {
        select: {
          name: true,
        },
      },
      _count: {
        select: {
          questions: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return res.status(200).json({
    success: true,
    data: quizzes,
  });
});

/**
 * Retrieve aggregated dashboard statistics for the user
 * @route GET /user/dashboard
 */
const getUserDashboard = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // 1. Fetch User Profile
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      bio: true,
      xp: true,
      level: true,
      streak: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // 2. Fetch User's Created Quizzes
  const myQuizzes = await prisma.quiz.findMany({
    where: { creatorId: userId },
    include: {
      category: { select: { name: true } },
      _count: { select: { questions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // 3. Aggregate Performance Stats
  const performance = await prisma.quizAttempt.aggregate({
    where: { userId: userId, completedAt: { not: null } },
    _count: { id: true },
    _avg: { accuracy: true },
    _sum: { xpEarned: true },
  });

  // 4. Fetch Recent Activity ie. last 5 quizzes played by the user
  const recentActivity = await prisma.quizAttempt.findMany({
    where: { userId: userId, completedAt: { not: null } },
    take: 5,
    orderBy: { completedAt: "desc" },
    include: { quiz: { select: { title: true } } },
  });

  return res.status(200).json({
    success: true,
    data: {
      profile: user,
      myQuizzes, // All quizzes created by the user
      statistics: {
        totalQuizzesPlayed: performance._count.id,
        totalQuizzesCreated: myQuizzes.length,
        averageAccuracy: performance._avg.accuracy || 0,
        totalXPEarned: performance._sum.xpEarned || 0,
      },
      recentActivity,
      goals: {
        xpProgress: getXPProgress(user.xp),
      },
    },
  });
});

/**
 * Rate a quiz
 * @route POST /user/rate-quiz
 */
const rateQuiz = asyncHandler(async (req, res) => {
  const { quizId, rating, comment } = req.body;
  const userId = req.user.id;

  // 1. Check if quiz exists
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
  });

  if (!quiz) {
    throw new NotFoundError("Quiz not found");
  }

  // 2. Record/update the rating.
  await prisma.quizRating.upsert({
    where: {
      quizId_userId: {
        quizId,
        userId,
      },
    },
    update: {
      rating,
      comment,
    },
    create: {
      quizId,
      userId,
      rating,
      comment,
    },
  });

  // 3. Calculate new average rating for the quiz
  const aggregations = await prisma.quizRating.aggregate({
    where: { quizId },
    _avg: {
      rating: true,
    },
  });

  const averageRating = Math.round(aggregations._avg.rating || 0);

  // 4. Update the Quiz model with the new rounded average
  const updatedQuiz = await prisma.quiz.update({
    where: { id: quizId },
    data: {
      rating: averageRating,
    },
  });

  return res.status(200).json({
    success: true,
    message: "Quiz rated successfully",
    data: {
      userRating: rating,
      quizAverageRating: averageRating,
      quiz: updatedQuiz,
    },
  });
});

export {
  getUser,
  getUserById,
  updateProfile,
  changePassword,
  uploadProfilePicture,
  deleteProfilePicture,
  getUserQuizzes,
  getUserDashboard,
  rateQuiz,
  changeEmail,
  verifyEmailChange,
  changeUsername,
};
