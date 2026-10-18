import { Router } from "express";
import { getImageKitAuth } from "../controllers/media.controller.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const mediaRouter = Router();

// Route to get ImageKit authentication parameters
mediaRouter.get("/auth", verifyToken, getImageKitAuth);

export default mediaRouter;
