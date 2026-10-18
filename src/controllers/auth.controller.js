import { prisma } from "../lib/prisma.js";
import { hashPassword, comparePassword } from "../utils/password.util.js";
import { generateId } from "../utils/id.util.js";
import { generateResetToken } from "../utils/token.util.js";
import { sendResetEmail } from "../services/email.service.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import "dotenv/config";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from "../utils/error.util.js";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Register a new user
 * @route POST /auth/signup
 */
const signupUser = asyncHandler(async (req, res) => {
  const data = req.body;

  // Check if username already exists
  const existingUsername = await prisma.user.findUnique({
    where: { username: data.username },
  });

  if (existingUsername) {
    throw new ConflictError("Username already exists");
  }

  // Check if email already exists
  const existingEmail = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existingEmail) {
    throw new ConflictError("Email already exists");
  }

  // Generate a unique ID for the user
  const id = generateId("user");

  // Create user using Prisma
  const newUser = await prisma.user.create({
    data: {
      id,
      firstName: data.first_name || data.firstName || null,
      lastName: data.last_name || data.lastName || null,
      email: data.email,
      username: data.username,
      password: await hashPassword(data.password),
    },
  });

  // Remove password from response
  delete newUser.password;

  // Generate token (auto-login after signup)
  const token = jwt.sign(
    { id: newUser.id, email: newUser.email },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN,
    },
  );

  // Send token as an httpOnly cookie
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: Number(process.env.JWT_EXPIRES_IN_MS) || 24 * 60 * 60 * 1000,
  });

  return res.status(201).json({
    success: true,
    message: "User created successfully",
    data: newUser,
    token,
  });
});

/**
 * Log in an existing user
 * @route POST /auth/login
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const isPasswordValid = await comparePassword(password, user.password);

  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid password");
  }

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN,
    },
  );

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: Number(process.env.JWT_EXPIRES_IN_MS) || 24 * 60 * 60 * 1000,
  });

  delete user.password;

  return res.status(200).json({
    success: true,
    message: "User logged in successfully",
    data: user,
    token,
  });
});

/**
 * Authenticate or register user via Google OAuth ID Token
 * @route POST /auth/google
 */
const googleAuth = asyncHandler(async (req, res) => {
  const { idToken, credential, token: fallbackToken } = req.body;
  const token = idToken || credential || fallbackToken;

  if (!token) {
    throw new BadRequestError("Google ID token is required");
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    throw new UnauthorizedError("Invalid or expired Google token");
  }

  if (!payload || !payload.email) {
    throw new UnauthorizedError(
      "Google authentication failed: Email not found in token payload",
    );
  }

  const { email, given_name, family_name, name, picture } = payload;

  let user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    let baseUsername = (email.split("@")[0] || "user")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    if (!baseUsername) baseUsername = "user";

    let username = baseUsername;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${baseUsername}${counter++}`;
    }

    const id = generateId("user");
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const hashedPassword = await hashPassword(randomPassword);

    user = await prisma.user.create({
      data: {
        id,
        firstName: given_name || name || null,
        lastName: family_name || null,
        email,
        username,
        password: hashedPassword,
        profilePicture: picture || null,
      },
    });
  }

  const jwtToken = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN,
    },
  );

  res.cookie("token", jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: Number(process.env.JWT_EXPIRES_IN_MS) || 24 * 60 * 60 * 1000,
  });

  delete user.password;

  return res.status(200).json({
    success: true,
    message: "Google authentication successful",
    data: user,
    token: jwtToken,
  });
});




/**
 * Log out the current user
 * @route GET /auth/logout
 */
const logoutUser = asyncHandler(async (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
  return res.status(200).json({
    success: true,
    message: "User logged out successfully",
  });
});

/**
 * Request password reset
 * @route POST /auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new NotFoundError("User does not exist.");
  }

  const { rawToken, hashedToken } = generateResetToken();

  await prisma.user.update({
    where: { email },
    data: {
      resetPasswordToken: hashedToken,
      resetPasswordExpiry: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    },
  });

  const resetURL = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
  await sendResetEmail(email, resetURL);

  return res
    .status(200)
    .json({ success: true, message: "If this email exists, a reset link has been sent." });
});

/**
 * Reset password with token
 * @route POST /auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await prisma.user.findFirst({
    where: {
      resetPasswordToken: hashedToken,
      resetPasswordExpiry: { gte: new Date() },
    },
  });

  if (!user) {
    throw new BadRequestError("Invalid or expired token.");
  }

  const hashedPassword = await hashPassword(password);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      resetPasswordToken: null,
      resetPasswordExpiry: null,
    },
  });

  return res
    .status(200)
    .json({ success: true, message: "Password reset successful. You can now log in." });
});

export { signupUser, loginUser, logoutUser, forgotPassword, resetPassword, googleAuth };
