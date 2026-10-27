import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { db } from "../db.js";
import { HttpError, asAddress, asText, bad } from "../http.js";
import { requireAuth, signToken } from "../middleware.js";
import {
  findUserByEmail,
  findUserById,
  publicUser,
  assignDemoWallet,
  createChallenge,
  verifyChallenge,
  assertAddressFree,
} from "../users.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count towards the lockout
  message: { error: "Too many failed attempts. Please wait a few minutes and try again." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A real bcrypt hash to burn the same time on unknown e-mails (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("chainwill-timing-pad", 10);

function parseCredentials(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email) || email.length > 254) throw bad("Enter a valid e-mail address");
  return { email, password };
}

/** Message a MetaMask user must sign to prove they control an address. */
router.get("/challenge", (req, res) => {
  const address = asAddress(req.query.address, "address");
  res.json({ address, message: createChallenge(address) });
});

router.post("/register", authLimiter, async (req, res) => {
  const { email, password } = parseCredentials(req.body);
  const name = asText(req.body.name, "Name", { min: 2, max: 60 });
  if (password.length < 8 || password.length > 128) throw bad("Password must be 8-128 characters");
  const walletMode = req.body.walletMode === "metamask" ? "metamask" : "demo";

  if (findUserByEmail(email)) throw new HttpError(409, "An account with this e-mail already exists");

  let metamaskAddress = null;
  if (walletMode === "metamask") {
    metamaskAddress = verifyChallenge(asAddress(req.body.address, "address"), String(req.body.signature || ""));
    assertAddressFree(metamaskAddress);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let userId;
  try {
    userId = Number(
      db
        .prepare("INSERT INTO users (name, email, password_hash, wallet_mode, wallet_address) VALUES (?, ?, ?, ?, ?)")
        .run(name, email, passwordHash, walletMode, metamaskAddress).lastInsertRowid
    );
  } catch (err) {
    if (String(err.code).startsWith("SQLITE_CONSTRAINT")) {
      throw new HttpError(409, "That e-mail or wallet is already registered");
    }
    throw err;
  }

  if (walletMode === "demo") {
    try {
      const { address } = await assignDemoWallet(userId);
      db.prepare("UPDATE users SET wallet_address = ? WHERE id = ?").run(address, userId);
    } catch (err) {
      db.prepare("DELETE FROM users WHERE id = ?").run(userId); // no half-registered accounts
      throw err;
    }
  }

  const user = findUserById(userId);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post("/login", authLimiter, async (req, res) => {
  const { email, password } = parseCredentials(req.body);
  const user = findUserByEmail(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "Incorrect e-mail or password");
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
