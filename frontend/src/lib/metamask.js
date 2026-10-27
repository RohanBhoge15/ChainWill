// Thin EIP-1193 helpers. No web3 library ships to the browser: the backend
// encodes every transaction, MetaMask only signs and broadcasts it.

export const hasMetaMask = () => typeof window !== "undefined" && Boolean(window.ethereum);

function ethereum() {
  if (!hasMetaMask()) {
    throw new Error("MetaMask is not installed. Install the extension, or use Demo Wallet mode.");
  }
  return window.ethereum;
}

/** MetaMask rejects with { code: 4001 } when the user clicks "Reject". */
export function metamaskMessage(err) {
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED") return "Request rejected in MetaMask.";
  const nested = err?.data?.message || err?.data?.originalError?.message || err?.error?.message;
  const raw = nested || err?.message || String(err);
  const revert = /revert(?:ed)?:?\s*(?:with reason string\s*)?["']?([^"']+?)["']?\s*$/i.exec(raw);
  return revert ? revert[1] : raw;
}

export async function connectMetaMask() {
  const [address] = await ethereum().request({ method: "eth_requestAccounts" });
  if (!address) throw new Error("No account was shared by MetaMask.");
  return address;
}

const toHex = (text) =>
  "0x" + Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");

export function signMessage(address, message) {
  return ethereum().request({ method: "personal_sign", params: [toHex(message), address] });
}

/** Switch MetaMask to the local Ganache chain, adding the network if it is unknown. */
export async function ensureChain(chain) {
  const eth = ethereum();
  const current = await eth.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === chain.chainIdHex.toLowerCase()) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch (err) {
    if (err?.code !== 4902 && !/unrecognized chain|not been added/i.test(err?.message || "")) throw err;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chain.chainIdHex,
          chainName: "Ganache (ChainWill)",
          rpcUrls: [chain.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  }
}

export async function sendTransaction(tx, expectedFrom) {
  const eth = ethereum();
  const [active] = await eth.request({ method: "eth_requestAccounts" });
  if (active?.toLowerCase() !== expectedFrom.toLowerCase()) {
    throw new Error(
      `MetaMask is on account ${active?.slice(0, 8)}…, but this ChainWill account is linked to ${expectedFrom.slice(0, 8)}…. Switch accounts in MetaMask.`
    );
  }
  return eth.request({ method: "eth_sendTransaction", params: [tx] });
}
