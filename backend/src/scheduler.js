import cron from "node-cron";
import { config } from "./config.js";
import { db } from "./db.js";
import { clock } from "./chain.js";
import { displayName } from "./wills.js";
import { notifyAddress, firstTime } from "./notify.js";
import { dueAlerts, humanDuration, ALERT_ORDER } from "./lifecycle.js";

/**
 * The dead-man's-switch watcher. Every few seconds it projects each live will
 * to the current chain time and sends the alert for any deadline that has just
 * been crossed. It only ever *informs* — the contract alone decides, at mining
 * time, whether an activation is allowed.
 */

function alertsFor(type, will, now) {
  const owner = will.owner_address;
  const ownerName = displayName(owner);
  const toDeadline = humanDuration(will.checkInDeadline - now);
  const toEligible = humanDuration(will.graceDeadline - now);

  switch (type) {
    case "CHECKIN_WARN":
      return [
        {
          to: owner,
          title: "⏰ Please check in",
          message: `${toDeadline} left before your will enters its grace period. Tap "I'm Alive" to reset the timer.`,
          link: "/app",
        },
      ];
    case "GRACE_START":
      return [
        {
          to: owner,
          title: "⚠️ Check-in missed — grace period started",
          message: `You missed your check-in. If you do not check in within ${toEligible}, your executor will be able to activate inheritance.`,
          link: "/app",
        },
        {
          to: will.executor_address,
          title: "⚠️ Grace period started",
          message: `${ownerName} missed their check-in. Their will becomes eligible for inheritance in ${toEligible} unless they check in.`,
          link: "/app/executor",
        },
      ];
    case "GRACE_WARN":
      return [
        {
          to: owner,
          title: "🚨 Last chance to check in",
          message: `Your will becomes eligible for inheritance in ${toEligible}. Check in now to stop it.`,
          link: "/app",
        },
        {
          to: will.executor_address,
          title: "🚨 Will about to become eligible",
          message: `${ownerName}'s will becomes eligible for inheritance in ${toEligible}.`,
          link: "/app/executor",
        },
      ];
    case "ELIGIBLE":
      return [
        {
          to: will.executor_address,
          title: "🔔 Will eligible for inheritance",
          message: `${ownerName} has not checked in and the grace period is over. You can now activate inheritance.`,
          link: "/app/executor",
        },
        {
          to: owner,
          title: "🚨 Your will is eligible for inheritance",
          message: "The grace period is over. Your executor can activate inheritance at any moment — check in now if you are able to.",
          link: "/app",
        },
      ];
    default:
      return [];
  }
}

export async function runSchedulerOnce() {
  const now = clock.now();
  const wills = db
    .prepare(
      `SELECT owner_address, executor_address, checkin_interval, grace_period, last_checkin_at
         FROM wills_cache
        WHERE activated_at_chain = 0 AND last_synced_status != 'REVOKED'`
    )
    .all();

  let crossedDeadline = false;
  for (const row of wills) {
    const will = {
      ...row,
      checkInInterval: row.checkin_interval,
      gracePeriod: row.grace_period,
      checkInDeadline: row.last_checkin_at + row.checkin_interval,
      graceDeadline: row.last_checkin_at + row.checkin_interval + row.grace_period,
    };
    // one alert per stage per check-in cycle; a fresh check-in starts a new cycle
    const cycle = `${will.owner_address}:${row.last_checkin_at}`;
    const fresh = dueAlerts(will, now).filter((type) => firstTime(`${cycle}:${type}`));
    if (fresh.length === 0) continue;

    // If several stages became due at once (e.g. the server was off), only the
    // most advanced one is still news.
    const latest = fresh.sort((a, b) => ALERT_ORDER.indexOf(a) - ALERT_ORDER.indexOf(b)).at(-1);
    for (const alert of alertsFor(latest, will, now)) {
      notifyAddress(alert.to, { type: latest, title: alert.title, message: alert.message, link: alert.link });
    }
    if (latest === "GRACE_START" || latest === "ELIGIBLE") crossedDeadline = true;
  }

  // Mine one block so the contract's own views (getStatus) catch up with the clock.
  if (crossedDeadline) await clock.tick().catch(() => {});
  return wills.length;
}

let task = null;
let busy = false;

export function startScheduler() {
  if (task) return;
  task = cron.schedule(`*/${config.schedulerSeconds} * * * * *`, async () => {
    if (busy) return;
    busy = true;
    try {
      await runSchedulerOnce();
    } catch (err) {
      console.warn(`[scheduler] run failed: ${err.message}`);
    } finally {
      busy = false;
    }
  });
}

export function stopScheduler() {
  task?.stop();
  task = null;
}
