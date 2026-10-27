import jwt from "jsonwebtoken";
import multer from "multer";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import { ChainRevert, isRevert, revertReason } from "./chain.js";
import { findUserById } from "./users.js";

export function signToken(user) {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function requireAuth(req, _res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, "Authentication required"));
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, "Session expired — please log in again"));
  }
  const user = findUserById(Number(payload.sub));
  if (!user) return next(new HttpError(401, "Account no longer exists"));
  req.user = user;
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== "admin") return next(new HttpError(403, "Admin access only"));
  next();
}

export function requireWallet(req, _res, next) {
  if (!req.user?.wallet_address) return next(new HttpError(409, "This account has no wallet"));
  next();
}

export function notFound(req, _res, next) {
  next(new HttpError(404, `No route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err instanceof ChainRevert || isRevert(err)) {
    // The contract said no. This is the security model working, not a server fault.
    const reason = revertReason(err);
    console.log(`[chain] revert for ${req.user?.email || "anonymous"} on ${req.method} ${req.path}: ${reason}`);
    return res.status(400).json({ error: reason, reverted: true });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large" : `Upload rejected: ${err.message}`;
    return res.status(400).json({ error: message });
  }
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body" });
  if (err?.code === "ECONNREFUSED" || /ECONNREFUSED|failed to detect network/i.test(err?.message || "")) {
    return res.status(503).json({ error: "The blockchain node is not reachable. Is Ganache running?" });
  }
  console.error(`[error] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: "Internal server error" });
}
