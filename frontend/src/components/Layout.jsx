import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Bell,
  FolderLock,
  Gavel,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings as SettingsIcon,
  ShieldAlert,
  Telescope,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { useNow } from "../lib/clock.js";
import { shortAddress } from "../lib/format.js";
import { livePhase, pendingClaims } from "../lib/willMath.js";
import { usePolling } from "../hooks/usePolling.js";
import { Identicon } from "./ui.jsx";
import { NotificationBell } from "./NotificationBell.jsx";

export function Logo({ className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className="text-lg font-bold tracking-tight text-white">
        Chain<span className="text-emerald-400">Will</span>
      </span>
    </span>
  );
}

/** How many wills are waiting on this user in each role (drives the nav badges). */
function useRoleBadges(walletAddress) {
  const now = useNow();
  const { data } = usePolling(
    async () => {
      if (!walletAddress) return { executor: [], beneficiary: [] };
      const [executor, beneficiary] = await Promise.all([api.get("/wills/as-executor"), api.get("/wills/as-beneficiary")]);
      return { executor: executor.wills, beneficiary: beneficiary.wills };
    },
    6000,
    [walletAddress]
  );
  if (!data) return { executor: 0, beneficiary: 0 };
  return {
    executor: data.executor.filter((w) => livePhase(w, now) === "ELIGIBLE").length,
    beneficiary: data.beneficiary.filter((w) => {
      const pending = pendingClaims(w, walletAddress);
      return pending.share || pending.items.length > 0;
    }).length,
  };
}

export function Layout() {
  const { user, wallet, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const badges = useRoleBadges(user.walletAddress);

  const nav = isAdmin
    ? [
        { to: "/app/admin", label: "Admin dashboard", icon: LayoutDashboard },
        { to: "/app/explorer", label: "Explorer", icon: Telescope },
        { to: "/app/notifications", label: "Notifications", icon: Bell },
        { to: "/app/settings", label: "Settings", icon: SettingsIcon },
      ]
    : [
        { to: "/app", label: "My will", icon: ScrollText, end: true },
        { to: "/app/executor", label: "Executor", icon: Gavel, badge: badges.executor },
        { to: "/app/beneficiary", label: "Beneficiary", icon: Gift, badge: badges.beneficiary },
        { to: "/app/vault", label: "Document vault", icon: FolderLock },
        { to: "/app/explorer", label: "Explorer", icon: Telescope },
        { to: "/app/security", label: "Security lab", icon: ShieldAlert },
        { to: "/app/notifications", label: "Notifications", icon: Bell },
        { to: "/app/settings", label: "Settings", icon: SettingsIcon },
      ];

  const signOut = () => {
    logout();
    navigate("/");
  };

  const links = (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {nav.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive ? "bg-emerald-500/10 text-emerald-300" : "text-slate-400 hover:bg-ink-800 hover:text-slate-100"
            }`
          }
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="flex-1">{label}</span>
          {badge > 0 && (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-bold text-white" aria-label={`${badge} need attention`}>
              {badge}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-ink-800 bg-ink-900/60 p-4 lg:flex">
        <Link to="/app" className="mb-8 px-2 pt-2">
          <Logo />
        </Link>
        {links}
        <div className="mt-auto space-y-3">
          <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
            <p className="truncate text-sm font-semibold text-slate-100">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button className="btn btn-ghost w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950/80 px-4 py-3 backdrop-blur sm:px-8">
          <button className="rounded-lg p-2 text-slate-300 hover:bg-ink-800 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/app" className="lg:hidden">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {user.walletAddress ? (
              <Link
                to="/app/settings"
                className="hidden items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 py-1.5 pr-3 pl-1.5 hover:border-ink-500 sm:flex"
                title="Wallet details"
              >
                <Identicon address={user.walletAddress} size={28} />
                <span className="leading-tight">
                  <span className="mono block text-slate-200">{shortAddress(user.walletAddress)}</span>
                  <span className="block text-[11px] text-slate-500">
                    {wallet ? `${wallet.ethFormatted} ETH` : "…"} · {user.walletMode === "demo" ? "Demo wallet" : "MetaMask"}
                  </span>
                </span>
              </Link>
            ) : (
              <span className="chip border-sky-500/40 bg-sky-500/10 text-sky-300">Read-only admin</span>
            )}
            <NotificationBell />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
          <Outlet />
        </main>
      </div>

      {/* Drawer (mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-ink-700 bg-ink-900 p-4">
            <div className="mb-6 flex items-center justify-between px-2 pt-2">
              <Logo />
              <button className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-800" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {links}
            <button className="btn btn-ghost mt-auto w-full justify-start" onClick={signOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
