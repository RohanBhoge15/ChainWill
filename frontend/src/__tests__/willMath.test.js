import { describe, expect, it } from "vitest";
import {
  buildWillPlan,
  fromBaseUnits,
  fromSeconds,
  isPositiveAmount,
  livePhase,
  pendingClaims,
  remainingPercent,
  splitPreview,
  sumPercent,
  timerState,
  toBaseUnits,
  toSeconds,
  validateBeneficiaries,
  validatePeriod,
} from "../lib/willMath.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const CAROL = "0x2222222222222222222222222222222222222222";
const DAVE = "0x3333333333333333333333333333333333333333";

describe("percentage validator", () => {
  it("sums shares and reports what is left", () => {
    const rows = [{ address: CAROL, pct: "60" }, { address: DAVE, pct: "40" }];
    expect(sumPercent(rows)).toBe(100);
    expect(remainingPercent(rows)).toBe(0);
    expect(validateBeneficiaries(rows, OWNER).ok).toBe(true);
  });

  it("allows a total below 100 (the remainder stays in escrow)", () => {
    const result = validateBeneficiaries([{ address: CAROL, pct: "30" }], OWNER);
    expect(result.ok).toBe(true);
    expect(remainingPercent([{ address: CAROL, pct: "30" }])).toBe(70);
  });

  it("rejects a total above 100", () => {
    const result = validateBeneficiaries([{ address: CAROL, pct: "90" }, { address: DAVE, pct: "40" }], OWNER);
    expect(result.ok).toBe(false);
    expect(result.total).toBe("Total is 130% — 30% over the limit");
  });

  it("rejects duplicates, the owner, bad addresses and bad percentages", () => {
    const result = validateBeneficiaries(
      [
        { address: CAROL, pct: "10" },
        { address: CAROL.toUpperCase().replace("0X", "0x"), pct: "10" },
        { address: OWNER, pct: "10" },
        { address: "0x123", pct: "10" },
        { address: DAVE, pct: "0" },
        { address: "", pct: "" },
      ],
      OWNER
    );
    expect(result.rows).toEqual([
      null,
      "Already listed above",
      "You cannot be your own beneficiary",
      "Not a valid Ethereum address",
      "Percentage must be a whole number from 1 to 100",
      "Choose a beneficiary",
    ]);
    expect(result.ok).toBe(false);
  });

  it("requires at least one beneficiary", () => {
    expect(validateBeneficiaries([], OWNER).total).toBe("Add at least one beneficiary");
  });

  it("rejects fractional percentages (the contract stores a uint8)", () => {
    expect(validateBeneficiaries([{ address: CAROL, pct: "33.5" }], OWNER).rows[0]).toMatch(/whole number/);
  });
});

describe("split preview", () => {
  it("divides a fungible amount by share", () => {
    const rows = [{ address: CAROL, name: "Carol", pct: 60 }, { address: DAVE, name: "Dave", pct: 40 }];
    expect(splitPreview("10", rows).map((r) => r.amount)).toEqual([6, 4]);
    expect(splitPreview("", rows)).toEqual([]);
    expect(splitPreview("abc", rows)).toEqual([]);
  });
});

describe("amounts", () => {
  it("converts decimals to base units exactly", () => {
    expect(toBaseUnits("1")).toBe(10n ** 18n);
    expect(toBaseUnits("0.1")).toBe(10n ** 17n);
    expect(toBaseUnits("1234.000000000000000001")).toBe(1234n * 10n ** 18n + 1n);
    expect(fromBaseUnits(1500000000000000000n)).toBe("1.5");
    expect(fromBaseUnits("1000000000000000000000")).toBe("1000");
    expect(fromBaseUnits(toBaseUnits("0.3") - toBaseUnits("0.1"))).toBe("0.2"); // 0.3 - 0.1 without float error
  });

  it("recognises valid positive amounts", () => {
    expect(isPositiveAmount("10")).toBe(true);
    expect(isPositiveAmount("0.5")).toBe(true);
    for (const bad of ["0", "", "-1", "1e3", "abc", "1.", ".5", "1.0000000000000000001"]) expect(isPositiveAmount(bad)).toBe(false);
  });
});

describe("schedule", () => {
  it("converts between seconds and friendly units", () => {
    expect(toSeconds(2, "minutes")).toBe(120);
    expect(fromSeconds(120)).toEqual({ value: 2, unit: "minutes" });
    expect(fromSeconds(30 * 86400)).toEqual({ value: 30, unit: "days" });
    expect(fromSeconds(90)).toEqual({ value: 90, unit: "seconds" });
  });

  it("enforces the contract's bounds", () => {
    expect(validatePeriod(120, "Interval")).toBeNull();
    expect(validatePeriod(5, "Interval")).toMatch(/at least 10 seconds/);
    expect(validatePeriod(NaN, "Interval")).toMatch(/whole number/);
    expect(validatePeriod(4000 * 86400, "Interval")).toMatch(/10 years/);
  });
});

describe("wizard plan", () => {
  const draft = {
    executor: OWNER,
    interval: 120,
    grace: 60,
    beneficiaries: [
      { address: CAROL, name: "Carol", pct: "60" },
      { address: DAVE, name: "Dave", pct: "40" },
    ],
    ethAmount: "10",
    tokenAmount: "1000",
    nfts: [{ name: "Property Deed", kind: "PROPERTY", assignedTo: CAROL, assignedName: "Carol" }],
    documents: [{ id: 7, name: "property_papers.pdf", assignedTo: DAVE, assignedName: "Dave" }],
  };

  it("orders the transactions: will → beneficiaries → fungible → NFTs → documents", () => {
    expect(buildWillPlan(draft).map((s) => s.action)).toEqual([
      "createWill",
      "addBeneficiary",
      "addBeneficiary",
      "depositEth",
      "mintToken",
      "approveToken",
      "depositToken",
      "mintNft",
      "approveNft",
      "registerNft",
      "registerDocument",
    ]);
  });

  it("feeds the minted tokenId into the approve and register steps", () => {
    const steps = buildWillPlan(draft);
    const results = { "nft-0-mint": { events: [{ name: "Transfer", args: {} }, { name: "DeedMinted", args: { tokenId: "42" } }] } };
    expect(steps.find((s) => s.id === "nft-0-approve").params(results)).toEqual({ tokenId: "42" });
    expect(steps.find((s) => s.id === "nft-0-register").params(results)).toEqual({ tokenId: "42", assignedTo: CAROL });
  });

  it("skips empty optional assets", () => {
    const steps = buildWillPlan({ ...draft, ethAmount: "", tokenAmount: "0", nfts: [], documents: [] });
    expect(steps.map((s) => s.action)).toEqual(["createWill", "addBeneficiary", "addBeneficiary"]);
  });

  it("passes whole-number percentages and the document id through", () => {
    const steps = buildWillPlan(draft);
    expect(steps[1].params).toEqual({ wallet: CAROL, pct: 60 });
    expect(steps.at(-1).params).toEqual({ documentId: 7, assignedTo: DAVE });
  });
});

describe("lifecycle timer", () => {
  // lastCheckIn 1000, interval 120, grace 60
  const will = { phase: "ACTIVE", activated: false, checkInInterval: 120, gracePeriod: 60, checkInDeadline: 1120, graceDeadline: 1180 };

  it("counts down the check-in window", () => {
    expect(timerState(will, 1030)).toMatchObject({ stage: "ACTIVE", secondsLeft: 90, progress: 0.25 });
    expect(timerState(will, 1120)).toMatchObject({ stage: "ACTIVE", secondsLeft: 0 }); // on the deadline is still on time
  });

  it("then counts down the grace period", () => {
    expect(timerState(will, 1121)).toMatchObject({ stage: "MISSED", secondsLeft: 59 });
    expect(timerState(will, 1150).progress).toBe(0.5);
    expect(timerState(will, 1180).stage).toBe("MISSED");
  });

  it("becomes eligible strictly after the grace deadline", () => {
    expect(timerState(will, 1181)).toMatchObject({ stage: "ELIGIBLE", overdueBy: 1 });
  });

  it("stops for activated and revoked wills", () => {
    expect(timerState({ ...will, activated: true, phase: "PARTIALLY_CLAIMED" }, 5000).stage).toBe("ACTIVATED");
    expect(timerState({ ...will, phase: "REVOKED" }, 5000).stage).toBe("REVOKED");
  });

  it("livePhase advances between polls but keeps server-only phases", () => {
    expect(livePhase(will, 1130)).toBe("MISSED");
    expect(livePhase(will, 1200)).toBe("ELIGIBLE");
    expect(livePhase({ ...will, activated: true, phase: "FULLY_CLAIMED" }, 1200)).toBe("FULLY_CLAIMED");
    expect(livePhase({ ...will, phase: "REVOKED" }, 1200)).toBe("REVOKED");
  });
});

describe("pendingClaims", () => {
  const will = {
    activated: true,
    hasFungible: true,
    beneficiaries: [{ address: CAROL, hasClaimed: false }, { address: DAVE, hasClaimed: true }],
    assets: [
      { index: 0, type: "ETH", removed: false, isClaimed: false, assignedTo: null },
      { index: 1, type: "ERC721", removed: false, isClaimed: false, assignedTo: { address: CAROL } },
      { index: 2, type: "DOCUMENT", removed: false, isClaimed: true, assignedTo: { address: DAVE } },
      { index: 3, type: "ERC721", removed: true, isClaimed: false, assignedTo: { address: DAVE } },
    ],
  };

  it("lists the share and the items still open for each heir", () => {
    expect(pendingClaims(will, CAROL.toUpperCase().replace("0X", "0x"))).toMatchObject({ share: true, items: [{ index: 1 }] });
    expect(pendingClaims(will, DAVE)).toEqual({ share: false, items: [] });
  });

  it("is empty before activation and for outsiders", () => {
    expect(pendingClaims({ ...will, activated: false }, CAROL)).toEqual({ share: false, items: [] });
    expect(pendingClaims(will, OWNER)).toEqual({ share: false, items: [] });
  });
});
