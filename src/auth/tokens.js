import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

export const AUTH_COOKIE = "auth_token";
export const CSRF_COOKIE = "csrf_token";
export const TOKEN_TTL_SECONDS = 15 * 60;

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createJwt(user, secret) {
  return jwt.sign(
    { ver: user.token_version },
    secret,
    {
      algorithm: "HS256",
      expiresIn: TOKEN_TTL_SECONDS,
      issuer: "knoukno-auth",
      subject: String(user.id),
    },
  );
}

export function verifyJwt(token, secret) {
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    issuer: "knoukno-auth",
  });
}
