import { Router } from "express";
import {
  signupUser,
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  googleAuth,
} from "../controllers/auth.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
} from "../validators/auth.validator.js";

const authRouter = Router();

authRouter.post("/signup", validate(signupSchema), signupUser);
authRouter.post("/login", validate(loginSchema), loginUser);
authRouter.post("/google", validate(googleAuthSchema), googleAuth);
authRouter.get("/logout", verifyToken, logoutUser);
authRouter.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
authRouter.post("/reset-password", validate(resetPasswordSchema), resetPassword);

export default authRouter;
