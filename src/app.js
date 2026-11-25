import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { CSRF_COOKIE } from "./auth/tokens.js";
import { createAuthRouter } from "./auth/routes.js";
import { AppError } from "./errors.js";
import { createPaymentsRouter } from "./payments/routes.js";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

function csrfMatches(cookieToken, headerToken) {
  if (typeof cookieToken !== "string" || typeof headerToken !== "string") {
    return false;
  }
  const cookie = Buffer.from(cookieToken);
  const header = Buffer.from(headerToken);
  return cookie.length === header.length && timingSafeEqual(cookie, header);
}

export function createApp({
  repository,
  emailService,
  paypalService,
  jwtSecret,
  cookieSecure = false,
  publicDir = publicDirectory,
}) {
  if (!repository || !emailService || !paypalService || !jwtSecret) {
    throw new Error("createApp requires repository, emailService, paypalService, and jwtSecret");
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "https://www.paypal.com", "https://api-m.paypal.com", "https://api.sandbox.paypal.com"],
        frameSrc: ["'self'", "https://www.paypal.com", "https://www.sandbox.paypal.com"],
        imgSrc: ["'self'", "data:", "https://www.paypal.com", "https://www.paypalobjects.com"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "https://www.paypal.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (!req.cookies[CSRF_COOKIE]) {
      res.cookie(CSRF_COOKIE, randomBytes(32).toString("base64url"), {
        httpOnly: false,
        secure: cookieSecure,
        sameSite: "lax",
        path: "/",
      });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.path.startsWith("/api/")) {
      if (!csrfMatches(req.cookies[CSRF_COOKIE], req.get("x-csrf-token"))) {
        return res.status(403).json({ error: "Request verification failed. Reload the page and try again." });
      }
    }
    return next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", createAuthRouter({ repository, emailService, jwtSecret, cookieSecure }));
  app.use("/api/paypal", createPaymentsRouter({ repository, paypalService, jwtSecret }));
  app.use(express.static(publicDir, { index: "index.html", maxAge: "1h" }));
  app.get("/login", (_req, res) => res.sendFile(path.join(publicDir, "login.html")));
  app.get("/register", (_req, res) => res.sendFile(path.join(publicDir, "register.html")));
  app.get("/forgot-password", (_req, res) => res.sendFile(path.join(publicDir, "forgot-password.html")));
  app.get("/dashboard", (_req, res) => res.sendFile(path.join(publicDir, "dashboard.html")));
  app.get("/verify-email", (_req, res) => res.sendFile(path.join(publicDir, "verify-email.html")));
  app.get("/reset-password", (_req, res) => res.sendFile(path.join(publicDir, "reset-password.html")));

  app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found" }));
  app.use((error, _req, res, _next) => {
    const status = error instanceof AppError
      ? error.status
      : Number.isInteger(error.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 500;
    if (status >= 500) {
      console.error(`Request failed (${status}): ${error.message}`);
    }
    return res.status(status).json({
      error: status === 500 ? "An unexpected server error occurred" : error.message || "Invalid request",
    });
  });
  return app;
}
