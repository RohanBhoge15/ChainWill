import { ethers } from "ethers";
import { db } from "./db.js";
import { manager, demoToken, demoNft, addresses, lower } from "./chain.js";
import { asAddress, asInt, asAmount, asText, bad, HttpError } from "./http.js";
import { humanDuration } from "./lifecycle.js";

const AssetType = { ETH: 0, ERC20: 1, ERC721: 2, DOCUMENT: 3 };
const MAX_PERIOD = 3650 * 86_400;

const seconds = (value, field) => asInt(value, field, { min: 10, max: MAX_PERIOD });
const call = (contract, method, args, value = 0n) => ({
  to: contract.target,
  data: contract.interface.encodeFunctionData(method, args),
  value,
});

/**
 * Every state-changing thing a user can do, as a whitelist. Each entry validates
 * its input and returns ONE unsigned transaction. The same transaction is then
 * either signed by the backend (Demo Wallet Mode) or handed to MetaMask — so both
 * wallet modes run exactly the same on-chain logic.
 */
const ACTIONS = {
  // ── owner: will set-up ──
  createWill(p) {
    const executor = asAddress(p.executor, "executor");
    const interval = seconds(p.interval, "interval");
    const grace = seconds(p.grace, "grace");
    return {
      ...call(manager, "createWill", [executor, interval, grace]),
      summary: `Create will (check-in every ${humanDuration(interval)}, grace ${humanDuration(grace)})`,
    };
  },
  addBeneficiary(p) {
    const wallet = asAddress(p.wallet, "wallet");
    const pct = asInt(p.pct, "pct", { min: 1, max: 100 });
    return { ...call(manager, "addBeneficiary", [wallet, pct]), summary: `Add beneficiary with ${pct}%` };
  },
  removeBeneficiary(p) {
    return { ...call(manager, "removeBeneficiary", [asAddress(p.wallet, "wallet")]), summary: "Remove beneficiary" };
  },
  updateSchedule(p) {
    const interval = seconds(p.interval, "interval");
    const grace = seconds(p.grace, "grace");
    return {
      ...call(manager, "updateSchedule", [interval, grace]),
      summary: `Change schedule to ${humanDuration(interval)} + ${humanDuration(grace)} grace`,
    };
  },
  updateExecutor(p) {
    return { ...call(manager, "updateExecutor", [asAddress(p.executor, "executor")]), summary: "Change executor" };
  },

  // ── owner: fungible assets (split by percentage) ──
  depositEth(p) {
    const amount = asAmount(p.amount, "amount");
    return {
      ...call(manager, "registerFungibleAsset", [AssetType.ETH, ethers.ZeroAddress, amount], amount),
      summary: `Deposit ${p.amount} ETH into the will's escrow`,
    };
  },
  mintToken(p, user) {
    const amount = asAmount(p.amount, "amount");
    return { ...call(demoToken, "mint", [user.wallet_address, amount]), summary: `Mint ${p.amount} demo tokens (CWT)` };
  },
  approveToken(p) {
    const amount = asAmount(p.amount, "amount");
    return {
      ...call(demoToken, "approve", [addresses.WillManager, amount]),
      summary: `Allow the will contract to escrow ${p.amount} CWT`,
    };
  },
  depositToken(p) {
    const amount = asAmount(p.amount, "amount");
    return {
      ...call(manager, "registerFungibleAsset", [AssetType.ERC20, addresses.DemoToken, amount]),
      summary: `Deposit ${p.amount} CWT into the will's escrow`,
    };
  },

  // ── owner: whole assets (assigned to one beneficiary) ──
  mintNft(p, user) {
    const name = asText(p.name, "name", { max: 64 });
    const kind = asText(p.kind ?? "OTHER", "kind", { max: 32 }).toUpperCase();
    return { ...call(demoNft, "mint", [user.wallet_address, name, kind]), summary: `Mint NFT "${name}"` };
  },
  approveNft(p) {
    const tokenId = asInt(p.tokenId, "tokenId", { min: 1 });
    return {
      ...call(demoNft, "approve", [addresses.WillManager, tokenId]),
      summary: `Allow the will contract to escrow NFT #${tokenId}`,
    };
  },
  registerNft(p) {
    const tokenId = asInt(p.tokenId, "tokenId", { min: 1 });
    const assignedTo = asAddress(p.assignedTo, "assignedTo");
    return {
      ...call(manager, "registerWholeAsset", [AssetType.ERC721, addresses.DemoNFT, tokenId, "", "", assignedTo]),
      summary: `Add NFT #${tokenId} to the will`,
    };
  },
  registerDocument(p, user) {
    const documentId = asInt(p.documentId, "documentId", { min: 1 });
    const assignedTo = asAddress(p.assignedTo, "assignedTo");
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!doc || doc.owner_address !== lower(user.wallet_address)) throw new HttpError(404, "Document not found");
    if (doc.asset_index !== null) throw bad("This document is already registered on-chain");
    return {
      ...call(manager, "registerWholeAsset", [AssetType.DOCUMENT, ethers.ZeroAddress, 0, doc.sha256_hash, doc.cid, assignedTo]),
      summary: `Register the fingerprint of "${doc.original_name}" on-chain`,
    };
  },
  reassignAsset(p) {
    const index = asInt(p.assetIndex, "assetIndex");
    return {
      ...call(manager, "reassignAsset", [index, asAddress(p.assignedTo, "assignedTo")]),
      summary: `Reassign asset #${index}`,
    };
  },
  removeAsset(p) {
    const index = asInt(p.assetIndex, "assetIndex");
    return { ...call(manager, "removeAsset", [index]), summary: `Withdraw asset #${index} from the will` };
  },

  // ── owner: lifecycle ──
  checkIn() {
    return { ...call(manager, "checkIn", []), summary: "Check in (proof of life)" };
  },
  revokeWill() {
    return { ...call(manager, "revokeWill", []), summary: "Revoke will and return all escrowed assets" };
  },

  // ── executor ──
  activateInheritance(p) {
    return {
      ...call(manager, "activateInheritance", [asAddress(p.owner, "owner")]),
      summary: "Activate inheritance",
    };
  },

  // ── beneficiary ──
  claimInheritance(p) {
    return {
      ...call(manager, "claimInheritance", [asAddress(p.owner, "owner")]),
      summary: "Claim percentage share (ETH + tokens)",
    };
  },
  claimAsset(p) {
    const index = asInt(p.assetIndex, "assetIndex");
    return {
      ...call(manager, "claimAsset", [asAddress(p.owner, "owner"), index]),
      summary: `Claim asset #${index}`,
    };
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

export function buildTx(action, params, user) {
  if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action)) throw bad(`Unknown action "${action}"`);
  if (!user.wallet_address) throw new HttpError(409, "This account has no wallet.");
  const tx = ACTIONS[action](params && typeof params === "object" ? params : {}, user);
  return { action, ...tx };
}
