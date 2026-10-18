import jwt from "jsonwebtoken";
import "dotenv/config";
import { UnauthorizedError } from "../utils/error.util.js";

export function verifyToken(req, res, next) {
  try {
    // 1. Read token from the cookie OR the Authorization header
    const token = req.cookies?.token || req.headers?.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Access denied. No token provided.",
        message: "Access denied. No token provided.",
      });
    }

    // 2. Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Attach the user payload (id, email) to req.user
    req.user = decoded;

    // 4. Proceed to next handler
    next();
  } catch (error) {
    console.error("Error verifying token:", error);
    return res.status(403).json({
      success: false,
      error: "Invalid or expired token.",
      message: "Invalid or expired token.",
    });
  }
}
