import { describe, expect, it } from "vitest";
import { describeEvent, formatBytes, formatCountdown, humanDuration, partyLabel, sameAddress, shortAddress } from "../lib/format.js";

const CAROL = "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d";

describe("formatting", () => {
  it("shortens addresses", () => {
    expect(shortAddress(CAROL)).toBe("0xE11B…882d");
    expect(shortAddress("")).toBe("");
    expect(partyLabel({ address: CAROL, name: "Carol" })).toBe("Carol");
    expect(partyLabel({ address: CAROL, name: null })).toBe("0xE11B…882d");
    expect(sameAddress(CAROL, CAROL.toLowerCase())).toBe(true);
    expect(sameAddress(CAROL, null)).toBe(false);
  });

  it("formats countdowns", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(102)).toBe("01:42");
    expect(formatCountdown(3909)).toBe("1:05:09");
    expect(formatCountdown(3 * 86400 + 4 * 3600 + 12 * 60)).toBe("3d 04h 12m");
    expect(formatCountdown(-5)).toBe("00:00");
  });

  it("formats durations and sizes", () => {
    expect(humanDuration(120)).toBe("2 minutes");
    expect(humanDuration(95)).toBe("1 minute 35 seconds");
    expect(humanDuration(30 * 86400)).toBe("30 days");
    expect(formatBytes(88)).toBe("88 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("describeEvent", () => {
  it("describes claims with amounts in whole units", () => {
    const base = { event: "AssetClaimed", args: { beneficiary: CAROL, t: "0", amount: "6000000000000000000", assetIndex: "1" } };
    expect(describeEvent(base)).toBe("0xE11B…882d claimed 6 ETH");
    expect(describeEvent({ ...base, args: { ...base.args, t: "2", amount: "1", assetIndex: "2" } })).toBe("0xE11B…882d claimed NFT #1 (asset #2)");
    expect(describeEvent({ ...base, args: { ...base.args, t: "3", amount: "0", assetIndex: "4" } })).toBe("0xE11B…882d claimed document (asset #4)");
  });

  it("uses registered names when the server supplies them", () => {
    const event = { event: "BeneficiaryAdded", args: { beneficiary: CAROL, pct: "60" }, names: { [CAROL.toLowerCase()]: "Carol" } };
    expect(describeEvent(event)).toBe("Beneficiary Carol added with 60%");
  });

  it("describes lifecycle events", () => {
    expect(describeEvent({ event: "CheckInPerformed", args: {} })).toBe("Owner checked in — timer reset");
    expect(describeEvent({ event: "WillRevoked", args: { ethRefunded: "2500000000000000000" } })).toBe("Will revoked · 2.5 ETH refunded");
    expect(describeEvent({ event: "WillCreated", args: { executor: CAROL, checkInInterval: "120", gracePeriod: "60" } })).toBe(
      "Will created · executor 0xE11B…882d · every 2 minutes + 1 minute grace"
    );
    expect(describeEvent({ event: "SomethingNew", args: {} })).toBe("SomethingNew");
  });
});
