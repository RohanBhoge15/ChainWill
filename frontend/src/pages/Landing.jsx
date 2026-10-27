import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, BellRing, CheckCircle2, FileLock2, Gavel, HeartPulse, KeyRound, ShieldCheck, Telescope, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { connectMetaMask, hasMetaMask, metamaskMessage, signMessage } from "../lib/metamask.js";
import { shortAddress } from "../lib/format.js";
import { getChainConfig } from "../lib/tx.js";
import { Logo } from "../components/Layout.jsx";
import { Button, ErrorNote, Field, Identicon, Loading } from "../components/ui.jsx";

const FEATURES = [
  { icon: HeartPulse, title: "Proof-of-life check-ins", text: "Tap “I'm alive” on your schedule. The contract only measures time since your last check-in — it never decides anyone is dead." },
  { icon: Gavel, title: "A human pulls the trigger", text: "Only after the interval and grace period lapse can your executor activate inheritance. Nobody else can, ever." },
  { icon: ShieldCheck, title: "Assets held in escrow", text: "ETH, tokens and NFTs sit in the smart contract. Percentages split the fungible ones; NFTs and documents go whole to one heir." },
  { icon: FileLock2, title: "Tamper-evident documents", text: "Files are AES-256 encrypted off-chain; their fingerprints live on-chain and unlock only after the heir's on-chain claim." },
  { icon: BellRing, title: "Real push notifications", text: "Warnings before a deadline, alerts when grace starts, and a nudge to heirs the moment they can claim." },
  { icon: Telescope, title: "Fully transparent", text: "Every will, check-in, activation and claim is a public event you can inspect in the built-in explorer." },
];

function AuthCard() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", walletMode: "demo" });
  const [metamask, setMetamask] = useState(null); // connected address
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chain, setChain] = useState(null);
  useEffect(() => {
    getChainConfig().then(setChain).catch(() => {});
  }, []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const done = (user) => navigate(location.state?.from || (user.role === "admin" ? "/app/admin" : "/app"), { replace: true });

  const connect = async () => {
    setError(null);
    try {
      setMetamask(await connectMetaMask());
    } catch (err) {
      setError(metamaskMessage(err));
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "login") {
        done(await login(form.email, form.password));
        return;
      }
      const payload = { ...form };
      if (form.walletMode === "metamask") {
        if (!metamask) throw new Error("Connect MetaMask first.");
        // Prove control of the address: sign a one-time challenge (free, no transaction).
        const { message, address } = await api.get(`/auth/challenge?address=${metamask}`);
        payload.address = address;
        try {
          payload.signature = await signMessage(metamask, message);
        } catch (err) {
          throw new Error(metamaskMessage(err));
        }
      }
      done(await register(payload));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad w-full max-w-md bg-ink-900/90">
      <div className="mb-6 grid grid-cols-2 rounded-xl border border-ink-700 bg-ink-850 p-1" role="tablist">
        {[
          ["login", "Sign in"],
          ["register", "Create account"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`rounded-lg py-2 text-sm font-semibold transition ${tab === key ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
            onClick={() => {
              setTab(key);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        {tab === "register" && (
          <Field label="Full name">
            {(id) => <input id={id} className="input" value={form.name} onChange={set("name")} autoComplete="name" required minLength={2} maxLength={60} placeholder="Alice Sharma" />}
          </Field>
        )}
        <Field label="E-mail">
          {(id) => <input id={id} type="email" className="input" value={form.email} onChange={set("email")} autoComplete="email" required placeholder="you@example.com" />}
        </Field>
        <Field label="Password" hint={tab === "register" ? "At least 8 characters." : undefined}>
          {(id) => (
            <input
              id={id}
              type="password"
              className="input"
              value={form.password}
              onChange={set("password")}
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
            />
          )}
        </Field>

        {tab === "register" && (
          <fieldset>
            <legend className="label">Wallet</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: "demo", icon: KeyRound, title: "Demo wallet", text: "We assign you a funded Ganache account. Nothing to install." },
                { key: "metamask", icon: Wallet, title: "MetaMask", text: "Sign every transaction yourself in the browser extension." },
              ].map(({ key, icon: Icon, title, text }) => (
                <label
                  key={key}
                  className={`relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition ${
                    form.walletMode === key ? "border-emerald-400 bg-emerald-500/10" : "border-ink-600 bg-ink-850 hover:border-ink-500"
                  }`}
                >
                  <input type="radio" name="walletMode" value={key} checked={form.walletMode === key} onChange={set("walletMode")} className="sr-only" />
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Icon className="h-4 w-4 text-emerald-400" /> {title}
                    {form.walletMode === key && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" />}
                  </span>
                  <span className="text-xs text-slate-400">{text}</span>
                </label>
              ))}
            </div>

            {form.walletMode === "metamask" && (
              <div className="mt-3 rounded-xl border border-ink-700 bg-ink-850 p-3.5">
                {metamask ? (
                  <div className="flex items-center gap-3">
                    <Identicon address={metamask} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">Connected account</p>
                      <p className="mono text-slate-200">{shortAddress(metamask, 10, 8)}</p>
                    </div>
                    <button type="button" className="text-xs link" onClick={connect}>
                      Change
                    </button>
                  </div>
                ) : hasMetaMask() ? (
                  <Button variant="secondary" className="w-full" icon={Wallet} onClick={connect}>
                    Connect MetaMask
                  </Button>
                ) : (
                  <p className="text-sm text-amber-300">MetaMask was not detected in this browser. Install the extension, or choose the demo wallet.</p>
                )}
                <p className="hint">
                  Point MetaMask at Ganache (RPC {chain?.rpcUrl ?? "http://127.0.0.1:7545"}, chain ID {chain?.chainId ?? 1337}) and import a Ganache private key so
                  the account has test ETH.
                </p>
              </div>
            )}
          </fieldset>
        )}

        <ErrorNote>{error}</ErrorNote>

        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {tab === "login" ? "Sign in" : "Create account"} {!busy && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  );
}

export default function Landing() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (user) return <Navigate to={user.role === "admin" ? "/app/admin" : "/app"} replace />;

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Logo />
        <Link to="/explorer" className="btn btn-ghost">
          <Telescope className="h-4 w-4" /> Public explorer
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid items-center gap-12 py-8 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <p className="chip mb-5 border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Decentralized digital will · runs on your local Ganache chain</p>
            <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-white sm:text-5xl">
              Your assets reach the right people — <span className="text-emerald-400">even if you can't hand them over.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-400">
              ChainWill is a dead-man's-switch will. Keep checking in and nothing happens. Stop, and after a grace period your executor can release
              your escrowed ETH, tokens, NFTs and documents to the beneficiaries you chose.
            </p>
            <ol className="mt-8 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-300">
              {["Create will", "Check in", "Deadline + grace lapse", "Executor activates", "Heirs claim"].map((step, i, all) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="rounded-full border border-ink-600 bg-ink-850 px-3 py-1.5">{step}</span>
                  {i < all.length - 1 && <ArrowRight className="h-4 w-4 text-slate-600" aria-hidden="true" />}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex justify-center lg:justify-end">
            <AuthCard />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card card-pad">
              <Icon className="mb-3 h-6 w-6 text-emerald-400" aria-hidden="true" />
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
