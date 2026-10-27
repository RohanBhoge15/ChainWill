import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, session } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshWallet = useCallback(async () => {
    try {
      setWallet(await api.get("/wallet"));
    } catch {
      /* no wallet (admin) or a transient error: keep the last known balances */
    }
  }, []);

  // Restore the session on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session.token) {
        try {
          const { user: me } = await api.get("/auth/me");
          if (!cancelled) setUser(me);
        } catch {
          session.clear();
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API layer fires this when the server says the token is no longer valid.
  useEffect(() => {
    const signedOut = () => {
      setUser(null);
      setWallet(null);
    };
    window.addEventListener("chainwill:signed-out", signedOut);
    return () => window.removeEventListener("chainwill:signed-out", signedOut);
  }, []);

  // Keep balances fresh while signed in.
  const walletAddress = user?.walletAddress;
  useEffect(() => {
    if (!walletAddress) {
      setWallet(null);
      return undefined;
    }
    refreshWallet();
    const timer = setInterval(refreshWallet, 6000);
    return () => clearInterval(timer);
  }, [walletAddress, refreshWallet]);

  const value = useMemo(() => {
    const accept = ({ token, user: me }) => {
      session.set(token);
      setUser(me);
      return me;
    };
    return {
      user,
      wallet,
      ready,
      isAdmin: user?.role === "admin",
      login: async (email, password) => accept(await api.post("/auth/login", { email, password })),
      register: async (form) => accept(await api.post("/auth/register", form)),
      logout() {
        session.clear();
        setUser(null);
        setWallet(null);
      },
      setUser,
      refreshWallet,
    };
  }, [user, wallet, ready, refreshWallet]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
