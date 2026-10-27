import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetch now, then every `intervalMs` while the tab is visible.
 * Returns { data, error, loading, refresh }. `refresh()` resolves with fresh data.
 */
export function usePolling(fetcher, intervalMs = 4000, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = generation.current;
    try {
      const data = await fetcherRef.current();
      if (mine === generation.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (mine === generation.current) setState((previous) => ({ data: previous.data, error, loading: false }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    generation.current++;
    setState({ data: undefined, error: null, loading: true });
    refresh();
    if (!intervalMs) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refresh, ...deps]);

  return { ...state, refresh };
}
