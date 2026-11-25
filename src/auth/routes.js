import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { AppError } from "../errors.js";
import { createRequireAuth } from "./middleware.js";
import {
  AUTH_COOKIE,
  createJwt,
  createOpaqueToken,
  hashToken,
  TOKEN_TTL_SECONDS,
} from "./tokens.js";

const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const passwordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, "Password must be no more than 72 bytes");
const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
const emailOnlySchema = z.object({ email: emailSchema });
const resetSchema = z.object({
  token: z.string().min(1).max(128),
  password: passwordSchema,
});
const verifySchema = z.object({ token: z.string().min(1).max(128) });

function validationError(error) {
  return {
    error: "Please check the submitted details",
    details: error.issues.map(({ path, message }) => ({ field: path.join("."), message })),
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.email_verified,
  };
}

function createAuthCookieOptions(secure) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS * 1000,
  };
}

export function createAuthRouter({ repository, emailService, jwtSecret, cookieSecure }) {
  const router = Router();
  const requireAuth = createRequireAuth({ repository, jwtSecret });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
  });

  router.post("/register", authLimiter, async (req, res, next) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationError(parsed.error));
    }

    const { name, email, password } = parsed.data;
    const token = createOpaqueToken();
    let user;
    try {
      user = await repository.createUser({
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        verificationTokenHash: hashToken(token),
        verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "An account with that email already exists" });
      }
      return next(error);
    }

    try {
      await emailService.sendVerificationEmail({ email, name, token });
    } catch (error) {
      return next(error);
    }
    return res.status(201).json({ message: "Account created. Check your email to verify it." });
  });

  router.post("/verify-email", async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationError(parsed.error));
    }
    const verified = await repository.verifyEmail(hashToken(parsed.data.token));
    if (!verified) {
      return res.status(400).json({ error: "The verification link is invalid or expired" });
    }
    return res.json({ message: "Email verified. You can now log in." });
  });

  router.post("/resend-verification", authLimiter, async (req, res, next) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationError(parsed.error));
    }
    const user = await repository.findUserByEmail(parsed.data.email);
    if (user && !user.email_verified) {
      const token = createOpaqueToken();
      await repository.setVerificationToken(
        user.id,
        hashToken(token),
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      );
      try {
        await emailService.sendVerificationEmail({ email: user.email, name: user.name, token });
      } catch (error) {
        return next(error);
      }
    }
    return res.status(202).json({ message: "If the account needs verification, an email has been sent." });
  });

  router.post("/login", authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationError(parsed.error));
    }
    const user = await repository.findUserByEmail(parsed.data.email);
    const passwordMatches = user
      ? await bcrypt.compare(parsed.data.password, user.password_hash)
      : false;
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: "Verify your email before logging in" });
    }

    res.cookie(AUTH_COOKIE, createJwt(user, jwtSecret), createAuthCookieOptions(cookieSecure));
    return res.json({ user: publicUser(user) });
  });

  router.post("/logout", requireAuth, async (req, res) => {
    await repository.revokeSessions(req.auth.user.id);
    res.clearCookie(AUTH_COOKIE, createAuthCookieOptions(cookieSecure));
    return res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.auth.user) }));

  router.post("/forgot-password", authLimiter, async (req, res, next) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationError(parsed.error));
    }
    const user = await repository.findUserByEmail(parsed.data.email);
    if (user) {
      const token = createOpaqueToken();
      await repository.setPasswordResetToken(
        user.id,
        hashToken(token),
        new Date(Date.now() + 60 * 60 * 1000),
      );
      try {
        await emailService.sendPasswordResetEmail({ email: user.email, name: user.name, token });
      } catch (error) {
        return next(error);
      }
    }
    return res.status(202).json({ message: "If the account exists, password reset instructions have been sent." });
  });

  router.post("/reset-password", authLimiter, async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationError(parsed.error));
    }
    const changed = await repository.resetPassword(
      hashToken(parsed.data.token),
      await bcrypt.hash(parsed.data.password, 12),
    );
    if (!changed) {
      return res.status(400).json({ error: "The password reset link is invalid or expired" });
    }
    return res.json({ message: "Password updated. You can now log in." });
  });

  return router;
}
