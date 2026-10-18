import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import "dotenv/config";
import morgan from "morgan";
import passport from "./config/passport.config.js";
import session from "express-session";
import userRouter from "./routes/user.routes.js";
import authRouter from "./routes/auth.routes.js";
import quizRouter from "./routes/quiz.routes.js";
import mediaRouter from "./routes/media.routes.js";
import { errorHandler } from "./middleware/error.middleware.js";

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(
  cors({
    // Allow requests from these origins
    origin: [
      "http://localhost:3000",
      "https://quizlo.vercel.app",
      "https://quizlo-app.vercel.app",
    ],
    credentials: true,
  }),
);

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Auth Routes
app.use("/auth", authRouter);

// User Routes
app.use("/user", userRouter);

// Quiz Routes
app.use("/quiz", quizRouter);

// Media Routes
app.use("/media", mediaRouter);

// Error Handling Middleware
app.use(errorHandler);

export default app;
