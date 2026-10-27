import { ethers } from "ethers";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (message) => new HttpError(400, message);

// ── Input validation ─────────────────────────────────────────────────────────────

export function asAddress(value, field = "address") {
  if (typeof value !== "string" || !ethers.isAddress(value.trim())) throw bad(`${field} is not a valid Ethereum address`);
  return ethers.getAddress(value.trim());
}

export function asInt(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number between ${min} and ${max}`);
  return n;
}

/** Decimal string/number → base units (wei). Rejects zero, negatives and garbage. */
export function asAmount(value, field = "amount", decimals = 18) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw bad(`${field} must be a positive number`);
  let parsed;
  try {
    parsed = ethers.parseUnits(text, decimals);
  } catch {
    throw bad(`${field} has too many decimal places`);
  }
  if (parsed <= 0n) throw bad(`${field} must be greater than 0`);
  return parsed;
}

export function asText(value, field, { min = 1, max = 200 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw bad(`${field} must be ${min}-${max} characters`);
  return text;
}
