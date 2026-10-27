import { useEffect, useState } from "react";
import { Coins, Link2, Link2Off, Network, Save } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { connectMetaMask, ensureChain, hasMetaMask, metamaskMessage, signMessage } from "../lib/metamask.js";
import { getChainConfig } from "../lib/tx.js";
import { useTx } from "../hooks/useTx.js";
import { ScheduleFields, scheduleErrors } from "../components/ScheduleFields.jsx";
import { AddressBadge, Button, Card, ConfirmButton, CopyButton, PageHeader, Tag } from "../components/ui.jsx";

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 py-3 last:border-b-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200">{children}</dd>
    </div>
  );
}

function ScheduleCard() {
  const { run, busy } = useTx();
  const [will, setWill] = useState(undefined);
  const [value, setValue] = useState(null);

  const load = () =>
    api.get("/wills/mine").then(({ will: mine }) => {
      setWill(mine);
      if (mine) setValue({ interval: mine.checkInInterval, grace: mine.gracePeriod });
    });
  useEffect(() => {
    load();
  }, []);

  if (will === undefined) return null;
  const editable = will && !will.activated && will.phase !== "REVOKED";
  if (!editable) {
    return (
      <Card title="Check-in schedule">
        <p className="text-sm text-slate-400">{will ? "This will can no longer be changed." : "You have no will yet. The schedule is chosen when you create one."}</p>
      </Card>
    );
  }
  const errors = scheduleErrors(value);
  const unchanged = value.interval === will.checkInInterval && value.grace === will.gracePeriod;

  return (
    <Card title="Check-in schedule">
      <ScheduleFields value={value} onChange={setValue} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Saving is an on-chain transaction and counts as a check-in.</p>
        <Button
          variant="primary"
          icon={Save}
          loading={busy}
          disabled={unchanged || Boolean(errors.interval || errors.grace)}
          onClick={async () => {
            if (await run("updateSchedule", value, { success: "Schedule updated — timer restarted" })) load();
          }}
        >
          Save schedule
        </Button>
      </div>
    </Card>
  );
}

function MetaMaskCard() {
  const { user, setUser, refreshWallet } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [chain, setChain] = useState(null);
  useEffect(() => {
    getChainConfig().then(setChain).catch(() => {});
  }, []);

  const link = async () => {
    setBusy("link");
    try {
      const account = await connectMetaMask();
      const { message, address } = await api.get(`/auth/challenge?address=${account}`);
      const signature = await signMessage(account, message);
      const { user: updated } = await api.post("/wallet/link-metamask", { address, signature });
      setUser(updated);
      refreshWallet();
      toast.success("MetaMask linked", { detail: "This account now signs its own transactions." });
    } catch (err) {
      toast.error("Could not link MetaMask", { detail: metamaskMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy("unlink");
    try {
      const { user: updated } = await api.post("/wallet/unlink-metamask");
      setUser(updated);
      refreshWallet();
      toast.success("Back on your demo wallet");
    } catch (err) {
      toast.error("Could not unlink", { detail: err.message });
    } finally {
      setBusy(null);
    }
  };

  const addNetwork = async () => {
    setBusy("network");
    try {
      await ensureChain(chain);
      toast.success("MetaMask is on the Ganache network");
    } catch (err) {
      toast.error("Could not switch network", { detail: metamaskMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="MetaMask">
      <p className="text-sm text-slate-400">
        {user.walletMode === "metamask"
          ? "Transactions are signed in your MetaMask extension. The server holds no key for this wallet."
          : "You are using a backend-managed demo wallet. Link MetaMask to sign transactions yourself instead."}
      </p>
      <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        Your will belongs to a wallet address, not to your login. Switching wallets switches which will, executor roles and inheritances you see.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {user.walletMode === "metamask" ? (
          <ConfirmButton icon={Link2Off} confirmLabel="Switch to demo wallet" loading={busy === "unlink"} onConfirm={unlink}>
            Unlink MetaMask
          </ConfirmButton>
        ) : (
          <Button variant="primary" icon={Link2} loading={busy === "link"} disabled={!hasMetaMask()} onClick={link}>
            Link MetaMask
          </Button>
        )}
        <Button icon={Network} loading={busy === "network"} disabled={!hasMetaMask() || !chain} onClick={addNetwork}>
          Add Ganache network to MetaMask
        </Button>
      </div>
      {!hasMetaMask() && <p className="hint">MetaMask was not detected in this browser.</p>}

      {chain && (
        <dl className="mt-4 rounded-xl border border-ink-700 bg-ink-850 px-4">
          <Row label="RPC URL">
            <span className="mono">{chain.rpcUrl}</span> <CopyButton value={chain.rpcUrl} />
          </Row>
          <Row label="Chain ID">
            <span className="mono">{chain.chainId}</span>
          </Row>
          <Row label="Currency">ETH</Row>
        </dl>
      )}
    </Card>
  );
}

export default function Settings() {
  const { user, wallet, isAdmin } = useAuth();
  const { run, pending } = useTx();

  return (
    <>
      <PageHeader title="Profile & settings" subtitle="Your account, your wallet and how you sign transactions." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <dl>
            <Row label="Name">{user.name}</Row>
            <Row label="E-mail">{user.email}</Row>
            <Row label="Role">{isAdmin ? <Tag tone="sky">Admin · read-only</Tag> : <Tag tone="emerald">Member</Tag>}</Row>
            <Row label="Joined">{new Date(user.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}</Row>
          </dl>
        </Card>

        {isAdmin ? (
          <Card title="Wallet">
            <p className="text-sm text-slate-400">The admin account is a read-only observer. It has no wallet and cannot send transactions.</p>
          </Card>
        ) : (
          <Card title="Wallet">
            <div className="mb-3">
              <AddressBadge address={user.walletAddress} name="On-chain identity" />
            </div>
            <dl>
              <Row label="Signing mode">
                {user.walletMode === "demo" ? <Tag tone="emerald">Demo wallet · key held encrypted on the server</Tag> : <Tag tone="amber">MetaMask · you hold the key</Tag>}
              </Row>
              {user.walletMode === "demo" && <Row label="Ganache account">{user.ganacheSlot !== null ? `#${user.ganacheSlot} of 10` : "extra funded account"}</Row>}
              <Row label="ETH balance">
                <span className="font-semibold">{wallet ? `${wallet.ethFormatted} ETH` : "…"}</span>
              </Row>
              <Row label="Demo tokens">
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{wallet ? `${wallet.token.balanceFormatted} ${wallet.token.symbol}` : "…"}</span>
                  <Button size="sm" icon={Coins} loading={pending === "mintToken"} onClick={() => run("mintToken", { amount: "100" }, { success: "Minted 100 demo tokens" })}>
                    Mint 100
                  </Button>
                </span>
              </Row>
              <Row label="NFTs in wallet">
                {wallet?.nfts.length ? (
                  <ul className="text-right">
                    {wallet.nfts.map((n) => (
                      <li key={n.tokenId}>
                        {n.name} <span className="text-slate-500">#{n.tokenId}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-slate-500">none</span>
                )}
              </Row>
            </dl>
          </Card>
        )}

        {!isAdmin && <MetaMaskCard />}
        {!isAdmin && <ScheduleCard />}
      </div>
    </>
  );
}
