import { useEffect, useReducer } from "react";

// The contract measures every deadline against the chain's clock, which on a
// local node can run ahead of the wall clock (the admin "fast-forward" tool).
// The backend tells us what time the chain thinks it is; we count from there.
let offsetSeconds = 0;

export function setChainNow(chainSeconds) {
  if (Number.isFinite(chainSeconds)) offsetSeconds = chainSeconds - Date.now() / 1000;
}

export function chainNow() {
  return Math.floor(Date.now() / 1000 + offsetSeconds);
}

/** Re-renders the caller once per second and returns the current chain time. */
export function useNow() {
  const [, tick] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return chainNow();
}
