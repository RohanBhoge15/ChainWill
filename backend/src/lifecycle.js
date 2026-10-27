// Pure lifecycle maths — no I/O, so it is unit-tested directly and mirrors
// WillManager.getPhase() exactly (same strict ">" comparisons).

const DAY = 86_400;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Derived lifecycle phase.
 *   ACTIVE → MISSED → ELIGIBLE            (time-driven, never stored on-chain)
 *   ACTIVATED → PARTIALLY_CLAIMED → FULLY_CLAIMED   (derived from the claim flags)
 *   REVOKED
 */
export function derivePhase(will, now) {
  if (will.revoked) return "REVOKED";
  if (will.activated) {
    const { total, claimed } = claimProgress(will);
    if (total > 0 && claimed === total) return "FULLY_CLAIMED";
    if (claimed > 0) return "PARTIALLY_CLAIMED";
    return "ACTIVATED";
  }
  if (now > will.graceDeadline) return "ELIGIBLE";
  if (now > will.checkInDeadline) return "MISSED";
  return "ACTIVE";
}

/** The four-value on-chain Status enum, projected to `now`. */
export function deriveStatus(will, now) {
  if (will.revoked) return "REVOKED";
  if (will.activated) return "ACTIVATED";
  return now > will.graceDeadline ? "ELIGIBLE" : "ACTIVE";
}

/**
 * How many separate claims this will has, and how many are done. Each
 * beneficiary's percentage share counts once (only if there is anything
 * fungible to split); each live NFT/document counts once.
 */
export function claimProgress(will) {
  const beneficiaries = will.beneficiaries || [];
  const assets = (will.assets || []).filter((a) => !a.removed);
  const whole = assets.filter((a) => a.type === "ERC721" || a.type === "DOCUMENT");
  const fungibleShares = will.hasFungible ? beneficiaries : [];
  return {
    total: fungibleShares.length + whole.length,
    claimed: fungibleShares.filter((b) => b.hasClaimed).length + whole.filter((a) => a.isClaimed).length,
  };
}

/** How long before a deadline the reminder goes out: a quarter of the period, 5s … 3 days. */
export function warnLead(period) {
  return clamp(Math.round(period / 4), 5, 3 * DAY);
}

export const ALERT_ORDER = ["CHECKIN_WARN", "GRACE_START", "GRACE_WARN", "ELIGIBLE"];

/** Timed alerts that are due at `now` for a will still waiting on its owner. */
export function dueAlerts({ checkInDeadline, graceDeadline, checkInInterval, gracePeriod }, now) {
  const due = [];
  if (now >= checkInDeadline - warnLead(checkInInterval)) due.push("CHECKIN_WARN");
  if (now > checkInDeadline) due.push("GRACE_START");
  if (now >= graceDeadline - warnLead(gracePeriod) && now > checkInDeadline) due.push("GRACE_WARN");
  if (now > graceDeadline) due.push("ELIGIBLE");
  return due;
}

/** 95 → "1 minute 35 seconds", 3600 → "1 hour", 0 → "0 seconds". */
export function humanDuration(totalSeconds) {
  let seconds = Math.max(0, Math.round(totalSeconds));
  const units = [
    ["day", DAY],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const parts = [];
  for (const [label, size] of units) {
    const count = Math.floor(seconds / size);
    if (count > 0) {
      parts.push(`${count} ${label}${count === 1 ? "" : "s"}`);
      seconds -= count * size;
    }
    if (parts.length === 2) break;
  }
  return parts.length ? parts.join(" ") : "0 seconds";
}
