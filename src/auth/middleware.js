import { AUTH_COOKIE, verifyJwt } from "./tokens.js";

export function createRequireAuth({ repository, jwtSecret }) {
  return async function requireAuth(req, res, next) {
    const token = req.cookies[AUTH_COOKIE];
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    let claims;
    try {
      claims = verifyJwt(token, jwtSecret);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }

    const user = await repository.findUserById(claims.sub);
    if (!user || user.token_version !== claims.ver || !user.email_verified) {
      return res.status(401).json({ error: "Authentication required" });
    }

    req.auth = { user };
    return next();
  };
}
