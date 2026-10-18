import { Router } from "express";
import {
  getUser,
  getUserById,
  updateProfile,
  changePassword,
  uploadProfilePicture,
  deleteProfilePicture,
  getUserQuizzes,
  getUserDashboard,
  changeEmail,
  verifyEmailChange,
  rateQuiz,
  changeUsername,
} from "../controllers/user.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  updateProfileSchema,
  changePasswordSchema,
  changeUsernameSchema,
  changeEmailSchema,
  verifyEmailChangeSchema,
  rateQuizSchema,
} from "../validators/user.validator.js";

const userRouter = Router();

userRouter.get("/me", verifyToken, getUser);
userRouter.get("/profile/:id", getUserById);
userRouter.patch("/profile", verifyToken, validate(updateProfileSchema), updateProfile);
userRouter.patch("/change-password", verifyToken, validate(changePasswordSchema), changePassword);
userRouter.get("/quizzes", verifyToken, getUserQuizzes);
userRouter.get("/dashboard", verifyToken, getUserDashboard);
userRouter.post("/rate-quiz", verifyToken, validate(rateQuizSchema), rateQuiz);
userRouter.patch("/change-username", verifyToken, validate(changeUsernameSchema), changeUsername);
userRouter.patch("/change-email", verifyToken, validate(changeEmailSchema), changeEmail);
userRouter.post("/verify-email-change", validate(verifyEmailChangeSchema), verifyEmailChange);
userRouter.patch(
  "/profile-picture",
  verifyToken,
  upload().single("profilePicture"),
  uploadProfilePicture,
);
userRouter.delete("/profile-picture", verifyToken, deleteProfilePicture);

export default userRouter;
