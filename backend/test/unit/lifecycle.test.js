import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePhase, deriveStatus, claimProgress, warnLead, dueAlerts, humanDuration } from "../../src/lifecycle.js";

// lastCheckIn = 1000, interval 120, grace 60
const base = { revoked: false, activated: false, checkInDeadline: 1120, graceDeadline: 1180, beneficiaries: [], assets: [], hasFungible: false };

test("phase follows the contract's strict '>' comparisons", () => {
  assert.equal(derivePhase(base, 1000), "ACTIVE");
  assert.equal(derivePhase(base, 1120), "ACTIVE"); // exactly at the deadline is still on time
  assert.equal(derivePhase(base, 1121), "MISSED");
  assert.equal(derivePhase(base, 1180), "MISSED"); // exactly at grace end is still grace
  assert.equal(derivePhase(base, 1181), "ELIGIBLE");
});

test("MISSED is a soft state: the four-value status stays ACTIVE", () => {
  assert.equal(deriveStatus(base, 1150), "ACTIVE");
  assert.equal(deriveStatus(base, 1181), "ELIGIBLE");
  assert.equal(deriveStatus({ ...base, activated: true }, 1000), "ACTIVATED");
});

test("revoked and activated wills ignore the clock", () => {
  assert.equal(derivePhase({ ...base, revoked: true }, 9999), "REVOKED");
  assert.equal(deriveStatus({ ...base, revoked: true }, 9999), "REVOKED");
  assert.equal(derivePhase({ ...base, activated: true }, 0), "ACTIVATED");
});

test("claim progress counts one fungible share per beneficiary and each live whole asset", () => {
  const will = {
    ...base,
    activated: true,
    hasFungible: true,
    beneficiaries: [{ hasClaimed: true }, { hasClaimed: false }],
    assets: [
      { type: "ETH", removed: false, isClaimed: false },
      { type: "ERC721", removed: false, isClaimed: true },
      { type: "DOCUMENT", removed: false, isClaimed: false },
      { type: "ERC721", removed: true, isClaimed: false }, // withdrawn: not claimable
    ],
  };
  assert.deepEqual(claimProgress(will), { total: 4, claimed: 2 });
  assert.equal(derivePhase(will, 0), "PARTIALLY_CLAIMED");

  will.beneficiaries[1].hasClaimed = true;
  will.assets[2].isClaimed = true;
  assert.equal(derivePhase(will, 0), "FULLY_CLAIMED");
});

test("with nothing fungible, percentage shares are not counted as claims", () => {
  const will = { ...base, activated: true, hasFungible: false, beneficiaries: [{ hasClaimed: false }], assets: [{ type: "DOCUMENT", removed: false, isClaimed: true }] };
  assert.deepEqual(claimProgress(will), { total: 1, claimed: 1 });
  assert.equal(derivePhase(will, 0), "FULLY_CLAIMED");
  assert.equal(derivePhase({ ...base, activated: true }, 0), "ACTIVATED"); // nothing to claim at all
});

test("reminder lead time is a quarter of the period, clamped", () => {
  assert.equal(warnLead(120), 30);
  assert.equal(warnLead(60), 15);
  assert.equal(warnLead(10), 5);
  assert.equal(warnLead(30 * 86400), 3 * 86400);
});

test("timed alerts become due in order", () => {
  const will = { checkInDeadline: 1120, graceDeadline: 1180, checkInInterval: 120, gracePeriod: 60 };
  assert.deepEqual(dueAlerts(will, 1000), []);
  assert.deepEqual(dueAlerts(will, 1090), ["CHECKIN_WARN"]);
  assert.deepEqual(dueAlerts(will, 1121), ["CHECKIN_WARN", "GRACE_START"]);
  assert.deepEqual(dueAlerts(will, 1165), ["CHECKIN_WARN", "GRACE_START", "GRACE_WARN"]);
  assert.deepEqual(dueAlerts(will, 1181), ["CHECKIN_WARN", "GRACE_START", "GRACE_WARN", "ELIGIBLE"]);
});

test("humanDuration", () => {
  assert.equal(humanDuration(0), "0 seconds");
  assert.equal(humanDuration(1), "1 second");
  assert.equal(humanDuration(95), "1 minute 35 seconds");
  assert.equal(humanDuration(3600), "1 hour");
  assert.equal(humanDuration(30 * 86400 + 3600), "30 days 1 hour");
  assert.equal(humanDuration(-5), "0 seconds");
});
