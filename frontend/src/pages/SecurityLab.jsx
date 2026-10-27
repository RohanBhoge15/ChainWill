import { useMemo, useState } from "react";
import { FlaskConical, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { partyLabel, sameAddress, shortAddress } from "../lib/format.js";
import { usePolling } from "../hooks/usePolling.js";
import { Button, Card, Empty, ErrorNote, Field, Loading, PageHeader, StatusChip } from "../components/ui.jsx";

/**
 * Lets anyone throw forbidden calls at the live contract and see it refuse.
 * Every attempt is a dry-run (eth_call): the real contract code executes with
 * the caller's address, but nothing is signed or mined.
 */
export default function SecurityLab() {
  const { user } = useAuth();
  const [target, setTarget] = useState("");
  const [assetIndex, setAssetIndex] = useState("");
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(null);
  const { data, error, loading } = usePolling(() => api.get("/explorer/wills"), 5000);

  const wills = data?.wills ?? [];
  const will = wills.find((w) => w.owner.address === target) || null;
  const mine = wills.find((w) => sameAddress(w.owner.address, user.walletAddress)) || null;
  const wholeAssets = will ? will.assets.filter((a) => a.type === "ERC721" || a.type === "DOCUMENT") : [];

  const attempts = useMemo(() => {
    const list = [];
    if (will) {
      const who = partyLabel(will.owner);
      list.push(
        {
          id: "activate",
          title: `Activate inheritance on ${who}'s will`,
          why: "Only the named executor may do this, and only once interval + grace have fully elapsed.",
          action: "activateInheritance",
          params: { owner: will.owner.address },
        },
        {
          id: "claim",
          title: `Claim a percentage share of ${who}'s will`,
          why: "Only a listed beneficiary, only after activation, and only once.",
          action: "claimInheritance",
          params: { owner: will.owner.address },
        }
      );
      if (assetIndex !== "") {
        const asset = will.assets[Number(assetIndex)];
        list.push({
          id: `asset-${assetIndex}`,
          title: `Claim “${asset.label}” (asset #${assetIndex})`,
          why: `This item is assigned whole to ${partyLabel(asset.assignedTo)}. Nobody else can take it, and it can be taken only once.`,
          action: "claimAsset",
          params: { owner: will.owner.address, assetIndex: Number(assetIndex) },
        });
      }
    }
    if (mine && mine.totalPercentage > 0) {
      const pct = 100 - mine.totalPercentage + 1;
      list.push({
        id: "overallocate",
        title: `Give away ${mine.totalPercentage + pct}% of my own will`,
        why: `Your will already allocates ${mine.totalPercentage}%. Adding a ${pct}% beneficiary would exceed 100%.`,
        action: "addBeneficiary",
        params: { wallet: "0x000000000000000000000000000000000000dEaD", pct },
      });
    }
    return list;
  }, [will, mine, assetIndex]);

  const attempt = async (item) => {
    setRunning(item.id);
    try {
      const outcome = await api.post("/tx/simulate", { action: item.action, params: item.params });
      if (!outcome.wouldSucceed) console.error(`[ChainWill] contract reverted on ${item.action}:`, outcome.reason);
      setResults((list) => [{ key: Date.now(), title: item.title, ...outcome }, ...list].slice(0, 12));
    } catch (err) {
      setResults((list) => [{ key: Date.now(), title: item.title, wouldSucceed: false, reason: err.message, failed: true }, ...list].slice(0, 12));
    } finally {
      setRunning(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Security lab"
        subtitle="Try to break the rules. Each attempt runs the real contract code as your wallet and shows exactly why it is refused. These are dry-runs: nothing is signed, mined or changed."
      />

      {loading ? (
        <Loading />
      ) : !data ? (
        <ErrorNote error={error} />
      ) : wills.length === 0 ? (
        <Card>
          <Empty icon={FlaskConical} title="No wills on-chain yet">
            Create a will first — then come back and try to attack it from another account.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="1 · Pick a target will">
            <Field label="Will">
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setAssetIndex("");
                  }}
                >
                  <option value="" disabled>
                    Choose a will to attack…
                  </option>
                  {wills.map((w) => (
                    <option key={w.owner.address} value={w.owner.address}>
                      {partyLabel(w.owner)} — {shortAddress(w.owner.address)}
                      {sameAddress(w.owner.address, user.walletAddress) ? " (yours)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {will && (
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Status</span>
                  <StatusChip phase={will.phase} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Executor</span>
                  <span className="text-slate-200">{partyLabel(will.executor)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400">Beneficiaries</span>
                  <span className="text-right text-slate-200">{will.beneficiaries.map((b) => `${partyLabel(b)} ${b.percentage}%`).join(", ") || "none"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">You are</span>
                  <span className="text-slate-200">
                    {[
                      sameAddress(will.owner.address, user.walletAddress) && "the owner",
                      sameAddress(will.executor.address, user.walletAddress) && "the executor",
                      will.beneficiaries.some((b) => sameAddress(b.address, user.walletAddress)) && "a beneficiary",
                    ]
                      .filter(Boolean)
                      .join(" and ") || "an outsider"}
                  </span>
                </div>
                {wholeAssets.length > 0 && (
                  <Field label="NFT / document to try to take">
                    {(id) => (
                      <select id={id} className="input" value={assetIndex} onChange={(e) => setAssetIndex(e.target.value)}>
                        <option value="">— none —</option>
                        {wholeAssets.map((a) => (
                          <option key={a.index} value={a.index}>
                            #{a.index} {a.label} → {partyLabel(a.assignedTo)}
                            {a.isClaimed ? " (claimed)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
              </div>
            )}
          </Card>

          <Card title="2 · Attempt something you should not be able to do">
            {attempts.length === 0 ? (
              <p className="text-sm text-slate-500">Pick a will to see what you can try.</p>
            ) : (
              <ul className="space-y-3">
                {attempts.map((item) => (
                  <li key={item.id} className="rounded-xl border border-ink-700 bg-ink-850 p-4">
                    <p className="font-semibold text-slate-100">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-400">{item.why}</p>
                    <Button variant="danger" size="sm" className="mt-3" icon={ShieldAlert} loading={running === item.id} onClick={() => attempt(item)}>
                      Try it
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="3 · What the contract said" className="lg:col-span-2">
            {results.length === 0 ? (
              <p className="text-sm text-slate-500">Results appear here. Revert reasons are also printed to the browser console.</p>
            ) : (
              <ul className="space-y-2" aria-live="polite">
                {results.map((r) => (
                  <li
                    key={r.key}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                      r.wouldSucceed ? "border-amber-500/40 bg-amber-500/10" : r.failed ? "border-slate-500/40 bg-slate-500/10" : "border-rose-500/40 bg-rose-500/10"
                    }`}
                  >
                    {r.wouldSucceed ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /> : <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />}
                    <div>
                      <p className="text-sm text-slate-300">{r.title}</p>
                      {r.wouldSucceed ? (
                        <p className="font-semibold text-amber-200">
                          Allowed — your wallet is genuinely authorised to do this right now. (Nothing was sent; use the dashboard to do it for real.)
                        </p>
                      ) : r.failed ? (
                        <p className="font-semibold text-slate-200">Could not run: {r.reason}</p>
                      ) : (
                        <p className="font-semibold text-rose-200">
                          Reverted by the contract: <span className="mono">“{r.reason}”</span>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
