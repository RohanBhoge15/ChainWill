import { Coins, FileText, Gem, Image as ImageIcon, Lock, Unlock } from "lucide-react";
import { useNow } from "../lib/clock.js";
import { PHASES, TONES, describeEvent, eventTone, formatCountdown, formatDateTime, humanDuration, partyLabel, sameAddress } from "../lib/format.js";
import { livePhase, timerState } from "../lib/willMath.js";
import { AddressBadge, ProgressBar, StatusChip, Tag, TxHash } from "./ui.jsx";

const STAGE_TONE = { ACTIVE: "emerald", MISSED: "amber", ELIGIBLE: "rose", ACTIVATED: "violet", REVOKED: "slate" };

/** Status chip that keeps ticking between server polls. */
export function LiveStatusChip({ will }) {
  const now = useNow();
  return <StatusChip phase={livePhase(will, now)} />;
}

/** The big countdown: time left in the check-in window, then in the grace period. */
export function LifecycleTimer({ will, compact = false }) {
  const now = useNow();
  const timer = timerState(will, now);
  const tone = STAGE_TONE[timer.stage];
  const counting = timer.stage === "ACTIVE" || timer.stage === "MISSED";

  const headline = counting
    ? formatCountdown(timer.secondsLeft)
    : timer.stage === "ELIGIBLE"
      ? "Eligible"
      : timer.stage === "ACTIVATED"
        ? "Activated"
        : "Revoked";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p
            className={`font-mono font-bold tabular-nums tracking-tight ${TONES[tone].text} ${compact ? "text-3xl" : "text-5xl sm:text-6xl"}`}
            role="timer"
            aria-live="off"
            aria-label={counting ? `${humanDuration(timer.secondsLeft)} ${timer.caption}` : headline}
          >
            {headline}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {timer.stage === "ELIGIBLE" ? `Grace period ended ${humanDuration(timer.overdueBy)} ago — ${timer.caption.toLowerCase()}` : timer.caption}
          </p>
        </div>
        {!compact && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500">
            <dt>Last check-in</dt>
            <dd className="text-right text-slate-300">{formatDateTime(will.lastCheckIn)}</dd>
            <dt>Check-in due</dt>
            <dd className="text-right text-slate-300">{formatDateTime(will.checkInDeadline)}</dd>
            <dt>Grace ends</dt>
            <dd className="text-right text-slate-300">{formatDateTime(will.graceDeadline)}</dd>
          </dl>
        )}
      </div>
      {counting && <ProgressBar value={timer.progress} tone={tone} className="mt-4" />}
      {!compact && (
        <p className="mt-3 text-xs text-slate-500">
          Check-in every <span className="text-slate-300">{humanDuration(will.checkInInterval)}</span>, then a grace period of{" "}
          <span className="text-slate-300">{humanDuration(will.gracePeriod)}</span>.
        </p>
      )}
    </div>
  );
}

const STEPS = [
  { key: "ACTIVE", label: "Active" },
  { key: "MISSED", label: "Missed" },
  { key: "ELIGIBLE", label: "Eligible" },
  { key: "ACTIVATED", label: "Activated" },
  { key: "FULLY_CLAIMED", label: "Claimed" },
];
const STEP_INDEX = { ACTIVE: 0, MISSED: 1, ELIGIBLE: 2, ACTIVATED: 3, PARTIALLY_CLAIMED: 3, FULLY_CLAIMED: 4 };

/** Where the will sits in the state machine. */
export function LifecycleSteps({ will }) {
  const now = useNow();
  const phase = livePhase(will, now);
  if (phase === "REVOKED") return null;
  const current = STEP_INDEX[phase] ?? 0;
  const tone = TONES[PHASES[phase].tone];
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Will lifecycle">
      {STEPS.map((step, i) => (
        <li key={step.key} className="flex items-center gap-1 sm:flex-1 sm:last:flex-none" aria-current={i === current ? "step" : undefined}>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 font-medium whitespace-nowrap ${
              i === current ? `${tone.chip} border` : i < current ? "text-slate-300" : "text-slate-600"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${i <= current ? tone.dot : "bg-ink-600"}`} />
            {step.label}
            {i === current && phase === "PARTIALLY_CLAIMED" ? " · claiming" : ""}
          </span>
          {i < STEPS.length - 1 && <span className={`hidden h-px flex-1 sm:block ${i < current ? "bg-slate-500" : "bg-ink-700"}`} />}
        </li>
      ))}
    </ol>
  );
}

export function BeneficiaryList({ will, viewerAddress, renderAction }) {
  if (will.beneficiaries.length === 0) {
    return <p className="py-4 text-sm text-slate-500">No beneficiaries yet. A will cannot be activated without at least one.</p>;
  }
  const unallocated = 100 - will.totalPercentage;
  return (
    <div>
      <ul className="divide-y divide-ink-800">
        {will.beneficiaries.map((b) => (
          <li key={b.address} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <AddressBadge party={b} you={sameAddress(b.address, viewerAddress)} />
            </div>
            <div className="w-40">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-lg font-bold text-white">{b.percentage}%</span>
                <span className="text-xs text-slate-500">
                  {b.share.ethFormatted !== "0" ? `${b.share.ethFormatted} ETH` : ""}
                  {b.share.tokens.filter((t) => t.amount !== "0").map((t) => ` · ${t.amountFormatted} ${t.symbol}`)}
                </span>
              </div>
              <ProgressBar value={b.percentage / 100} tone="sky" />
            </div>
            <div className="flex w-28 justify-end">
              {will.activated ? (
                b.hasClaimed ? (
                  <Tag tone="emerald">Claimed</Tag>
                ) : will.hasFungible ? (
                  <Tag tone="violet">Can claim</Tag>
                ) : null
              ) : (
                renderAction?.(b)
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className={`mt-2 text-xs ${unallocated > 0 ? "text-amber-300/90" : "text-slate-500"}`}>
        {will.totalPercentage}% allocated
        {unallocated > 0 && ` · ${unallocated}% unallocated — that part of the ETH and tokens would stay locked in escrow`}
      </p>
    </div>
  );
}

const ASSET_ICON = { ETH: Gem, ERC20: Coins, ERC721: ImageIcon, DOCUMENT: FileText };

export function AssetRow({ asset, will, children }) {
  const Icon = ASSET_ICON[asset.type];
  const fungible = asset.type === "ETH" || asset.type === "ERC20";
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${asset.removed ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <span className="rounded-xl border border-ink-700 bg-ink-850 p-2.5">
          <Icon className="h-5 w-5 text-slate-300" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{asset.label}</p>
          <p className="text-xs text-slate-500">
            #{asset.index} ·{" "}
            {asset.type === "ETH" ? "Ether" : asset.type === "ERC20" ? "ERC-20 token" : asset.type === "ERC721" ? `ERC-721 NFT${asset.nft?.kind ? ` · ${asset.nft.kind.toLowerCase()}` : ""}` : "Document fingerprint"}
            {asset.docHash && <span className="mono"> · sha256 {asset.docHash.slice(0, 10)}…</span>}
          </p>
        </div>
      </div>
      <div className="text-sm text-slate-400">
        {fungible ? (
          <span>Split by percentage</span>
        ) : (
          <span>
            Whole item → <span className="font-medium text-slate-200">{partyLabel(asset.assignedTo)}</span>
          </span>
        )}
      </div>
      <div className="flex min-w-24 items-center justify-end gap-2">
        {asset.removed ? (
          <Tag tone="slate">{will.phase === "REVOKED" ? "Returned" : "Withdrawn"}</Tag>
        ) : asset.isClaimed ? (
          <Tag tone="emerald">
            <Unlock className="h-3 w-3" /> Claimed
          </Tag>
        ) : will.activated && !fungible ? (
          <Tag tone="violet">Awaiting claim</Tag>
        ) : !fungible && asset.type === "DOCUMENT" ? (
          <Tag tone="slate">
            <Lock className="h-3 w-3" /> Locked
          </Tag>
        ) : null}
        {children}
      </div>
    </li>
  );
}

export function AssetList({ will, renderAction, filter }) {
  const assets = filter ? will.assets.filter(filter) : will.assets;
  if (assets.length === 0) return <p className="py-4 text-sm text-slate-500">No assets registered yet.</p>;
  return (
    <ul className="divide-y divide-ink-800">
      {assets.map((asset) => (
        <AssetRow key={asset.index} asset={asset} will={will}>
          {renderAction?.(asset)}
        </AssetRow>
      ))}
    </ul>
  );
}

export function EscrowSummary({ will }) {
  const frozen = will.activated;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
        <dt className="text-xs uppercase tracking-wider text-slate-500">ETH in escrow</dt>
        <dd className="mt-0.5 text-xl font-bold text-white">{will.ethEscrowFormatted}</dd>
        {frozen && <dd className="text-xs text-slate-500">of {will.ethSnapshotFormatted} at activation</dd>}
      </div>
      {will.tokens.map((t) => (
        <div key={t.address} className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
          <dt className="text-xs uppercase tracking-wider text-slate-500">{t.symbol} in escrow</dt>
          <dd className="mt-0.5 text-xl font-bold text-white">{t.escrowedFormatted}</dd>
          {frozen && <dd className="text-xs text-slate-500">of {t.snapshotFormatted} at activation</dd>}
        </div>
      ))}
      <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
        <dt className="text-xs uppercase tracking-wider text-slate-500">Whole items</dt>
        <dd className="mt-0.5 text-xl font-bold text-white">
          {will.assets.filter((a) => !a.removed && (a.type === "ERC721" || a.type === "DOCUMENT")).length}
        </dd>
        <dd className="text-xs text-slate-500">NFTs + documents</dd>
      </div>
    </dl>
  );
}

/** Chronological log of a will's contract events. */
export function EventList({ events, onOpenTx, empty = "No on-chain activity yet." }) {
  if (!events || events.length === 0) return <p className="py-4 text-sm text-slate-500">{empty}</p>;
  return (
    <ol className="space-y-0">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 border-b border-ink-800 py-2.5 last:border-b-0">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONES[eventTone(event.event)].dot}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-200">{describeEvent(event)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
              <span>{formatDateTime(event.timestamp)}</span>
              <span>block {event.blockNumber}</span>
              {event.from && <span>by {partyLabel(event.from)}</span>}
              <TxHash hash={event.txHash} onOpen={onOpenTx} />
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
