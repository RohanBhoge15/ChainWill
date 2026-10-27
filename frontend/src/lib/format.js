export const shortAddress = (address, lead = 6, tail = 4) =>
  address ? `${address.slice(0, lead)}…${address.slice(-tail)}` : "";
const shortenAddress = shortAddress;

export const shortHash = (hash) => (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "");

export const sameAddress = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** { address, name } → "Carol" or "0x1234…abcd" */
export const partyLabel = (party) => (party ? party.name || shortAddress(party.address) : "—");

const pad = (n) => String(n).padStart(2, "0");

/** Ticking-clock style: 01:42, 1:05:09, 3d 04h 12m */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** 95 → "1 minute 35 seconds", 2592000 → "30 days" */
export function humanDuration(totalSeconds) {
  let seconds = Math.max(0, Math.round(totalSeconds));
  const units = [
    ["day", 86400],
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

export function formatDateTime(unixSeconds) {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export const formatNumber = (value) => Number(value).toLocaleString();

// ── Lifecycle presentation ───────────────────────────────────────────────────────

export const PHASES = {
  ACTIVE: {
    label: "Active",
    tone: "emerald",
    blurb: "The owner is checking in on time.",
  },
  MISSED: {
    label: "Check-in missed",
    tone: "amber",
    blurb: "The deadline passed. The grace period is running.",
  },
  ELIGIBLE: {
    label: "Eligible for inheritance",
    tone: "rose",
    blurb: "Grace period over. The executor may activate inheritance.",
  },
  ACTIVATED: {
    label: "Inheritance activated",
    tone: "violet",
    blurb: "Beneficiaries can claim their shares.",
  },
  PARTIALLY_CLAIMED: {
    label: "Partially claimed",
    tone: "violet",
    blurb: "Some beneficiaries have claimed.",
  },
  FULLY_CLAIMED: {
    label: "Fully claimed",
    tone: "sky",
    blurb: "Every share and item has been claimed.",
  },
  REVOKED: {
    label: "Revoked",
    tone: "slate",
    blurb: "The owner cancelled this will; all assets were returned.",
  },
};

export const TONES = {
  emerald: { chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400", text: "text-emerald-300", bar: "bg-emerald-400" },
  amber: { chip: "border-amber-500/40 bg-amber-500/10 text-amber-300", dot: "bg-amber-400", text: "text-amber-300", bar: "bg-amber-400" },
  rose: { chip: "border-rose-500/40 bg-rose-500/10 text-rose-300", dot: "bg-rose-400", text: "text-rose-300", bar: "bg-rose-400" },
  violet: { chip: "border-violet-500/40 bg-violet-500/10 text-violet-300", dot: "bg-violet-400", text: "text-violet-300", bar: "bg-violet-400" },
  sky: { chip: "border-sky-500/40 bg-sky-500/10 text-sky-300", dot: "bg-sky-400", text: "text-sky-300", bar: "bg-sky-400" },
  slate: { chip: "border-slate-500/40 bg-slate-500/10 text-slate-300", dot: "bg-slate-400", text: "text-slate-300", bar: "bg-slate-400" },
};

export const ASSET_TYPE_LABEL = { ETH: "ETH", ERC20: "Token", ERC721: "NFT", DOCUMENT: "Document" };
const ASSET_TYPE_BY_INDEX = ["ETH", "ERC20", "ERC721", "DOCUMENT"];

const wei = (value, decimals = 18) => {
  const text = String(value).padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).slice(0, 6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const EVENT_TONE = {
  WillCreated: "emerald",
  CheckInPerformed: "emerald",
  BeneficiaryAdded: "sky",
  BeneficiaryRemoved: "slate",
  AssetRegistered: "sky",
  AssetAssigned: "sky",
  AssetRemoved: "slate",
  ScheduleUpdated: "slate",
  ExecutorChanged: "amber",
  InheritanceActivated: "violet",
  AssetClaimed: "violet",
  WillRevoked: "rose",
};
export const eventTone = (name) => EVENT_TONE[name] || "slate";

/** One-line, human description of an indexed contract event. */
export function describeEvent(event) {
  const a = event.args || {};
  // registered wallets are shown by name ("Carol"), everything else as 0x1234…abcd
  const shortAddress = (address) => event.names?.[String(address).toLowerCase()] || shortenAddress(address);
  const type = ASSET_TYPE_BY_INDEX[Number(a.t)] || "";
  switch (event.event) {
    case "WillCreated":
      return `Will created · executor ${shortAddress(a.executor)} · every ${humanDuration(Number(a.checkInInterval))} + ${humanDuration(Number(a.gracePeriod))} grace`;
    case "CheckInPerformed":
      return "Owner checked in — timer reset";
    case "BeneficiaryAdded":
      return `Beneficiary ${shortAddress(a.beneficiary)} added with ${a.pct}%`;
    case "BeneficiaryRemoved":
      return `Beneficiary ${shortAddress(a.beneficiary)} removed (${a.pct}% freed)`;
    case "AssetRegistered":
      if (type === "ETH") return `Asset #${a.assetIndex}: ${wei(a.amountOrId)} ETH escrowed`;
      if (type === "ERC20") return `Asset #${a.assetIndex}: ${wei(a.amountOrId)} tokens escrowed`;
      if (type === "ERC721") return `Asset #${a.assetIndex}: NFT #${a.amountOrId} escrowed → ${shortAddress(a.assignedTo)}`;
      return `Asset #${a.assetIndex}: document ${String(a.docHash).slice(0, 12)}… → ${shortAddress(a.assignedTo)}`;
    case "AssetAssigned":
      return `Asset #${a.assetIndex} assigned to ${shortAddress(a.beneficiary)}`;
    case "AssetRemoved":
      return `Asset #${a.assetIndex} (${ASSET_TYPE_LABEL[type] || "asset"}) withdrawn by owner`;
    case "ScheduleUpdated":
      return `Schedule changed to ${humanDuration(Number(a.checkInInterval))} + ${humanDuration(Number(a.gracePeriod))} grace`;
    case "ExecutorChanged":
      return `Executor changed to ${shortAddress(a.newExecutor)}`;
    case "InheritanceActivated":
      return `Inheritance activated by executor ${shortAddress(a.executor)}`;
    case "AssetClaimed":
      if (type === "ETH") return `${shortAddress(a.beneficiary)} claimed ${wei(a.amount)} ETH`;
      if (type === "ERC20") return `${shortAddress(a.beneficiary)} claimed ${wei(a.amount)} tokens`;
      if (type === "ERC721") return `${shortAddress(a.beneficiary)} claimed NFT #${a.amount} (asset #${a.assetIndex})`;
      return `${shortAddress(a.beneficiary)} claimed document (asset #${a.assetIndex})`;
    case "WillRevoked":
      return `Will revoked · ${wei(a.ethRefunded)} ETH refunded`;
    case "DeedMinted":
      return `NFT #${a.tokenId} "${a.name}" minted to ${shortAddress(a.to)}`;
    case "Transfer":
      return a.tokenId !== undefined
        ? `NFT #${a.tokenId}: ${shortAddress(a.from)} → ${shortAddress(a.to)}`
        : `${wei(a.value)} tokens: ${shortAddress(a.from)} → ${shortAddress(a.to)}`;
    case "Approval":
      return a.tokenId !== undefined
        ? `NFT #${a.tokenId} approved for ${shortAddress(a.approved)}`
        : `${shortAddress(a.spender)} approved to spend ${wei(a.value)} tokens`;
    case "ApprovalForAll":
      return `${shortAddress(a.operator)} ${a.approved ? "approved" : "revoked"} for all NFTs`;
    default:
      return event.event;
  }
}
