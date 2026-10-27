import { api } from "../lib/api.js";
import { usePolling } from "./usePolling.js";

/** The ChainWill address book (name → wallet), refreshed occasionally. */
export function useDirectory() {
  const { data } = usePolling(() => api.get("/wallet/directory"), 15000);
  return data?.users ?? [];
}
