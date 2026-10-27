// Pure helpers behind the Create-Will wizard and the lifecycle timer.

const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(String(value || "").trim());
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
export const MIN_PERIOD = 10;
export const MAX_PERIOD = 3650 * 86400;

export const toSeconds = (value, unit) => Math.round(Number(value) * (UNIT_SECONDS[unit] || 1));

/** 120 → { value: 2, unit: "minutes" } (largest unit that divides evenly) */
export function fromSeconds(seconds) {
  for (const unit of ["days", "hours", "minutes"]) {
    if (seconds >= UNIT_SECONDS[unit] && seconds % UNIT_SECONDS[unit] === 0) {
      return { value: seconds / UNIT_SECONDS[unit], unit };
    }
  }
  return { value: seconds, unit: "seconds" };
}

export function validatePeriod(seconds, name) {
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) return `${name} must be a whole number`;
  if (seconds < MIN_PERIOD) return `${name} must be at least ${MIN_PERIOD} seconds`;
  if (seconds > MAX_PERIOD) return `${name} cannot exceed 10 years`;
  return null;
}

export const SCHEDULE_PRESETS = [
  { id: "demo", label: "Live demo", detail: "2 min check-in · 1 min grace", interval: 120, grace: 60 },
  { id: "monthly", label: "Monthly", detail: "30 days · 7 days grace", interval: 30 * 86400, grace: 7 * 86400 },
  { id: "quarterly", label: "Quarterly", detail: "90 days · 14 days grace", interval: 90 * 86400, grace: 14 * 86400 },
];

// ── Percentages ──────────────────────────────────────────────────────────────────

const pct = (row) => {
  const n = Number(row.pct);
  return Number.isFinite(n) ? n : 0;
};

export const sumPercent = (rows) => rows.reduce((total, row) => total + pct(row), 0);
export const remainingPercent = (rows) => 100 - sumPercent(rows);

/**
 * Mirrors the contract's rules so mistakes are caught before a transaction is sent:
 * valid, unique, non-owner addresses; whole percentages 1-100; total <= 100.
 * Returns { rows: [error|null per row], total: error|null, ok }.
 */
export function validateBeneficiaries(rows, ownerAddress) {
  const seen = new Set();
  const rowErrors = rows.map((row) => {
    const address = String(row.address || "").trim();
    if (!address) return "Choose a beneficiary";
    if (!isAddress(address)) return "Not a valid Ethereum address";
    if (ownerAddress && same(address, ownerAddress)) return "You cannot be your own beneficiary";
    if (seen.has(address.toLowerCase())) return "Already listed above";
    seen.add(address.toLowerCase());
    const value = Number(row.pct);
    if (row.pct === "" || row.pct === null || row.pct === undefined) return "Enter a percentage";
    if (!Number.isInteger(value) || value < 1 || value > 100) return "Percentage must be a whole number from 1 to 100";
    return null;
  });

  const total = sumPercent(rows);
  let totalError = null;
  if (rows.length === 0) totalError = "Add at least one beneficiary";
  else if (total > 100) totalError = `Total is ${total}% — ${total - 100}% over the limit`;

  return { rows: rowErrors, total: totalError, ok: !totalError && rowErrors.every((e) => e === null) };
}

/** How a fungible amount would be divided. Amount stays a decimal string in, numbers out (display only). */
export function splitPreview(amount, rows) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return [];
  return rows
    .filter((row) => pct(row) > 0)
    .map((row) => ({ address: row.address, name: row.name, pct: pct(row), amount: +((value * pct(row)) / 100).toFixed(6) }));
}

export const isPositiveAmount = (value) => /^\d+(\.\d{1,18})?$/.test(String(value).trim()) && Number(value) > 0;

/** "1.5" → 1500000000000000000n. Exact — no floating point. */
export function toBaseUnits(text, decimals = 18) {
  const [whole, fraction = ""] = String(text).trim().split(".");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0");
}

/** 1500000000000000000n → "1.5" */
export function fromBaseUnits(value, decimals = 18) {
  const text = BigInt(value).toString().padStart(decimals + 1, "0");
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${text.slice(0, -decimals)}.${fraction}` : text.slice(0, -decimals);
}

// ── Wizard → ordered list of transactions ────────────────────────────────────────

/**
 * Turns the wizard draft into the exact sequence of on-chain actions.
 * `params` may be a function of the results of earlier steps (an NFT must be
 * minted before its tokenId can be approved and registered).
 */
export function buildWillPlan(draft) {
  const steps = [];
  const add = (id, action, label, params) => steps.push({ id, action, label, params });

  add("create", "createWill", "Create the will on-chain", {
    executor: draft.executor,
    interval: draft.interval,
    grace: draft.grace,
  });

  draft.beneficiaries.forEach((b, i) => {
    add(`beneficiary-${i}`, "addBeneficiary", `Add ${b.name || "beneficiary"} with ${b.pct}%`, {
      wallet: b.address,
      pct: Number(b.pct),
    });
  });

  if (isPositiveAmount(draft.ethAmount)) {
    add("eth", "depositEth", `Deposit ${draft.ethAmount} ETH into escrow`, { amount: String(draft.ethAmount).trim() });
  }

  if (isPositiveAmount(draft.tokenAmount)) {
    const amount = String(draft.tokenAmount).trim();
    add("token-mint", "mintToken", `Mint ${amount} demo tokens (CWT)`, { amount });
    add("token-approve", "approveToken", `Approve the will contract for ${amount} CWT`, { amount });
    add("token-deposit", "depositToken", `Deposit ${amount} CWT into escrow`, { amount });
  }

  draft.nfts.forEach((nft, i) => {
    const mintId = `nft-${i}-mint`;
    const tokenId = (results) => results[mintId]?.events.find((e) => e.name === "DeedMinted")?.args.tokenId;
    add(mintId, "mintNft", `Mint NFT "${nft.name}"`, { name: nft.name, kind: nft.kind });
    add(`nft-${i}-approve`, "approveNft", `Approve the will contract for "${nft.name}"`, (results) => ({
      tokenId: tokenId(results),
    }));
    add(`nft-${i}-register`, "registerNft", `Escrow "${nft.name}" → ${nft.assignedName || "beneficiary"}`, (results) => ({
      tokenId: tokenId(results),
      assignedTo: nft.assignedTo,
    }));
  });

  draft.documents.forEach((doc, i) => {
    add(`doc-${i}`, "registerDocument", `Record fingerprint of "${doc.name}" → ${doc.assignedName || "beneficiary"}`, {
      documentId: doc.id,
      assignedTo: doc.assignedTo,
    });
  });

  return steps;
}

// ── Lifecycle timer ──────────────────────────────────────────────────────────────

/**
 * What the big countdown should show for a will at chain time `now`.
 *   progress: 0 → 1 across the current window (interval, then grace)
 */
export function timerState(will, now) {
  const clamp = (n) => Math.min(1, Math.max(0, n));
  if (will.phase === "REVOKED") return { stage: "REVOKED", secondsLeft: 0, progress: 1, caption: "Will revoked" };
  if (will.activated) return { stage: "ACTIVATED", secondsLeft: 0, progress: 1, caption: "Inheritance activated" };

  if (now <= will.checkInDeadline) {
    const left = will.checkInDeadline - now;
    return {
      stage: "ACTIVE",
      secondsLeft: left,
      progress: clamp(1 - left / will.checkInInterval),
      caption: "until the next check-in is due",
    };
  }
  if (now <= will.graceDeadline) {
    const left = will.graceDeadline - now;
    return {
      stage: "MISSED",
      secondsLeft: left,
      progress: clamp(1 - left / will.gracePeriod),
      caption: "of grace period left",
    };
  }
  return {
    stage: "ELIGIBLE",
    secondsLeft: 0,
    overdueBy: now - will.graceDeadline,
    progress: 1,
    caption: "The executor can activate inheritance",
  };
}

/** Phase as the UI should show it this very second (between two polls of the server). */
export function livePhase(will, now) {
  if (will.phase === "REVOKED" || will.activated) return will.phase;
  return timerState(will, now).stage;
}

/**
 * What `address` can still claim from an ACTIVATED will:
 *   share → their percentage of ETH/tokens (claimInheritance)
 *   items → NFTs / documents assigned to them (claimAsset, one each)
 */
export function pendingClaims(will, address) {
  if (!will.activated || !address) return { share: false, items: [] };
  const me = will.beneficiaries.find((b) => same(b.address, address));
  return {
    share: Boolean(me && !me.hasClaimed && will.hasFungible),
    items: will.assets.filter((a) => !a.removed && !a.isClaimed && a.assignedTo && same(a.assignedTo.address, address)),
  };
}
