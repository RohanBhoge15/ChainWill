import fs from "node:fs";
import { ethers } from "ethers";
import { config } from "./config.js";

// ── Deployment manifest (addresses + ABIs written by blockchain/scripts/deploy.js) ──

function loadManifest() {
  if (!fs.existsSync(config.deploymentFile)) {
    throw new Error(
      `No deployment manifest at ${config.deploymentFile}. Start Ganache and run "npm run deploy" in the project root.`
    );
  }
  const manifest = JSON.parse(fs.readFileSync(config.deploymentFile, "utf8"));
  if (config.contractAddressOverride) {
    manifest.contracts.WillManager.address = ethers.getAddress(config.contractAddressOverride);
  }
  return manifest;
}

export const manifest = loadManifest();

export const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, {
  staticNetwork: true,
  cacheTimeout: -1, // always read fresh state; this is a local node
  pollingInterval: 1000,
});

const contractOf = (name) =>
  new ethers.Contract(manifest.contracts[name].address, manifest.contracts[name].abi, provider);

export const manager = contractOf("WillManager");
export const demoToken = contractOf("DemoToken");
export const demoNft = contractOf("DemoNFT");

export const addresses = {
  WillManager: manifest.contracts.WillManager.address,
  DemoToken: manifest.contracts.DemoToken.address,
  DemoNFT: manifest.contracts.DemoNFT.address,
};

const contractsByAddress = new Map(
  [
    ["WillManager", manager],
    ["DemoToken", demoToken],
    ["DemoNFT", demoNft],
  ].map(([name, contract]) => [addresses[name].toLowerCase(), { name, iface: contract.interface }])
);

export const lower = (address) => String(address).toLowerCase();
export const checksum = (address) => ethers.getAddress(address);

export const STATUS = ["ACTIVE", "ELIGIBLE", "ACTIVATED", "REVOKED"];
export const ASSET_TYPES = ["ETH", "ERC20", "ERC721", "DOCUMENT"];
export const FUNGIBLE_SHARE = ethers.MaxUint256;

// ── Chain clock ─────────────────────────────────────────────────────────────────
//
// Ganache answers eth_call / eth_estimateGas against the LAST MINED block, so a
// view such as getStatus() does not move while no transactions are being mined.
// Every deadline in the contract is measured against the NEXT block's timestamp,
// which on a local node is "wall clock + whatever evm_increaseTime added".
//
// `clock.now()` is that projected timestamp. `clock.tick()` mines one empty block
// when the head is stale, so simulations and gas estimates see the same time the
// real transaction will. The contract still has the final word when it is mined.

export const clock = {
  offset: 0,
  canMine: true,

  now() {
    return Math.floor(Date.now() / 1000) + this.offset;
  },

  /** Mine a block and measure how far the node's clock runs ahead of ours. */
  async sync() {
    try {
      await provider.send("evm_mine", []);
    } catch {
      this.canMine = false; // not a dev node: fall back to the head block's time
    }
    const block = await provider.getBlock("latest");
    const drift = block.timestamp - Math.floor(Date.now() / 1000);
    this.offset = Math.abs(drift) <= 2 ? 0 : drift;
    return this.offset;
  },

  /** Bring the head block up to "now" if it has fallen behind. */
  async tick() {
    if (!this.canMine) return false;
    const block = await provider.getBlock("latest");
    if (block.timestamp >= this.now()) return false;
    await provider.send("evm_mine", []);
    return true;
  },

  /** DEMO TOOL: jump the local chain forward. */
  async travel(seconds) {
    await provider.send("evm_increaseTime", [seconds]);
    return this.sync();
  },
};

// ── Wallets ─────────────────────────────────────────────────────────────────────

const mnemonic = ethers.Mnemonic.fromPhrase(config.mnemonic);

/** Ganache's i-th pre-funded account (BIP-44 m/44'/60'/0'/0/i). */
export function ganacheAccount(index) {
  return ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`);
}

export const GANACHE_SLOTS = 10;
export const ganacheAddresses = Array.from({ length: GANACHE_SLOTS }, (_, i) => lower(ganacheAccount(i).address));

// ── Errors ──────────────────────────────────────────────────────────────────────

export class ChainRevert extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = "ChainRevert";
    this.reason = reason;
    Object.assign(this, details);
  }
}

const FRIENDLY_CUSTOM_ERRORS = {
  ERC20InsufficientAllowance: "Token allowance too low — approve the WillManager first",
  ERC20InsufficientBalance: "Insufficient token balance",
  ERC721InsufficientApproval: "NFT is not approved for transfer — approve the WillManager first",
  ERC721NonexistentToken: "NFT does not exist",
  ERC721IncorrectOwner: "NFT is not owned by the sender",
  ReentrancyGuardReentrantCall: "Reentrant call blocked",
};

/** Pull a human-readable revert reason out of whatever ethers / the node threw. */
export function revertReason(err) {
  if (err instanceof ChainRevert) return err.reason;
  if (err?.reason) return err.reason;

  const data = err?.data ?? err?.info?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    for (const { iface } of contractsByAddress.values()) {
      try {
        const parsed = iface.parseError(data);
        if (parsed) return FRIENDLY_CUSTOM_ERRORS[parsed.name] || parsed.name;
      } catch {
        /* not this ABI */
      }
    }
  }

  const raw = err?.info?.error?.message || err?.error?.message || err?.shortMessage || err?.message || String(err);
  if (/insufficient funds|doesn't have enough funds/i.test(raw)) return "Insufficient ETH balance for this transaction";
  const match = /revert(?:ed)?:?\s*(?:with reason string\s*)?["']?([^"']+?)["']?\s*$/i.exec(raw);
  if (match && match[1] && !/^missing revert data$/i.test(match[1])) return match[1].trim();
  return raw;
}

export function isRevert(err) {
  return (
    err instanceof ChainRevert ||
    err?.code === "CALL_EXCEPTION" ||
    err?.code === "INSUFFICIENT_FUNDS" ||
    /revert|VM Exception|insufficient funds|enough funds/i.test(err?.message || "")
  );
}

// ── Sending transactions ────────────────────────────────────────────────────────

const queues = new Map();
/** One transaction at a time per sender, so nonces never collide. */
function serialised(key, task) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(key, next);
  next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {});
  return next;
}

const plain = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  return value;
};

/** Decode the logs of a receipt with our three ABIs. */
export function decodeLogs(logs) {
  const events = [];
  for (const log of logs) {
    const known = contractsByAddress.get(lower(log.address));
    if (!known) continue;
    let parsed;
    try {
      parsed = known.iface.parseLog(log);
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    const args = {};
    parsed.fragment.inputs.forEach((input, i) => {
      args[input.name || `arg${i}`] = plain(parsed.args[i]);
    });
    events.push({
      contract: known.name,
      name: parsed.name,
      args,
      logIndex: log.index,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  return events;
}

export function describeReceipt(receipt) {
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    from: receipt.from,
    to: receipt.to,
    status: receipt.status,
    events: decodeLogs(receipt.logs),
  };
}

/**
 * Dry-run a transaction against the current head (after ticking the clock) and
 * surface the contract's own revert reason. Nothing is mined by this.
 */
export async function simulate(from, tx) {
  await clock.tick();
  try {
    await provider.call({ from, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  } catch (err) {
    throw new ChainRevert(revertReason(err));
  }
}

/** Simulate, then sign with a backend-held demo wallet and wait for the receipt. */
export function sendFromWallet(wallet, tx) {
  const signer = wallet.connect(provider);
  return serialised(lower(signer.address), async () => {
    await simulate(signer.address, tx);
    try {
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
      const receipt = await sent.wait();
      return describeReceipt(receipt);
    } catch (err) {
      if (isRevert(err)) throw new ChainRevert(revertReason(err));
      throw err;
    }
  });
}

/** Receipt of a transaction the user sent themselves (MetaMask mode). */
export async function waitForReceipt(txHash, timeoutMs = 60_000) {
  const receipt = await provider.waitForTransaction(txHash, 1, timeoutMs);
  if (!receipt) throw new Error("Transaction was not mined in time");
  return receipt;
}

// ── Token / NFT metadata (immutable → cached forever) ───────────────────────────

const ERC20_META_ABI = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
const tokenMetaCache = new Map();

export async function tokenMeta(address) {
  const key = lower(address);
  if (!tokenMetaCache.has(key)) {
    const erc20 = new ethers.Contract(address, ERC20_META_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      erc20.symbol().catch(() => "TOKEN"),
      erc20.decimals().catch(() => 18n),
    ]);
    tokenMetaCache.set(key, { address: checksum(address), symbol, decimals: Number(decimals) });
  }
  return tokenMetaCache.get(key);
}

const deedCache = new Map();

export async function deedMeta(tokenAddress, tokenId) {
  if (lower(tokenAddress) !== lower(addresses.DemoNFT)) return { name: `NFT #${tokenId}`, kind: "" };
  const key = String(tokenId);
  if (!deedCache.has(key)) {
    try {
      const [name, kind] = await demoNft.deedOf(tokenId);
      deedCache.set(key, { name, kind });
    } catch {
      return { name: `NFT #${tokenId}`, kind: "" };
    }
  }
  return deedCache.get(key);
}

// ── Formatting ──────────────────────────────────────────────────────────────────

/** "10", "0.5", "1234.567891" — at most `maxDecimals` fraction digits, no trailing zeros. */
export function formatUnits(value, decimals = 18, maxDecimals = 6) {
  const [whole, fraction = ""] = ethers.formatUnits(value, decimals).split(".");
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export async function walletBalances(address) {
  const [eth, tokenBalance, tokenIds, meta] = await Promise.all([
    provider.getBalance(address),
    demoToken.balanceOf(address),
    demoNft.tokensOfOwner(address),
    tokenMeta(addresses.DemoToken),
  ]);
  const nfts = await Promise.all(
    tokenIds.map(async (id) => ({ tokenId: id.toString(), ...(await deedMeta(addresses.DemoNFT, id)) }))
  );
  return {
    eth: eth.toString(),
    ethFormatted: formatUnits(eth, 18, 4),
    token: {
      address: meta.address,
      symbol: meta.symbol,
      balance: tokenBalance.toString(),
      balanceFormatted: formatUnits(tokenBalance, meta.decimals, 4),
    },
    nfts,
  };
}
