import { useEffect, useState } from "react";
import { humanDuration } from "../lib/format.js";
import { SCHEDULE_PRESETS, fromSeconds, toSeconds, validatePeriod } from "../lib/willMath.js";
import { Field } from "./ui.jsx";

const UNITS = ["seconds", "minutes", "hours", "days"];

function PeriodInput({ label, hint, seconds, onChange, error }) {
  const [parts, setParts] = useState(() => fromSeconds(seconds));
  // follow external changes (presets) without fighting the user's typing
  useEffect(() => {
    if (toSeconds(parts.value, parts.unit) !== seconds) setParts(fromSeconds(seconds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const update = (next) => {
    setParts(next);
    onChange(next.value === "" ? NaN : toSeconds(next.value, next.unit));
  };

  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <div className="flex gap-2">
          <input
            id={id}
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            className="input w-28"
            value={parts.value}
            onChange={(e) => update({ ...parts, value: e.target.value })}
          />
          <select className="input" value={parts.unit} onChange={(e) => update({ ...parts, unit: e.target.value })} aria-label={`${label} unit`}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      )}
    </Field>
  );
}

export function scheduleErrors({ interval, grace }) {
  return { interval: validatePeriod(interval, "Check-in interval"), grace: validatePeriod(grace, "Grace period") };
}

/** Check-in interval + grace period, with one-click presets. */
export function ScheduleFields({ value, onChange }) {
  const errors = scheduleErrors(value);
  const valid = !errors.interval && !errors.grace;
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {SCHEDULE_PRESETS.map((preset) => {
          const selected = value.interval === preset.interval && value.grace === preset.grace;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ interval: preset.interval, grace: preset.grace })}
              className={`rounded-xl border p-3 text-left transition ${selected ? "border-emerald-400 bg-emerald-500/10" : "border-ink-600 bg-ink-850 hover:border-ink-500"}`}
            >
              <span className="block text-sm font-semibold text-white">{preset.label}</span>
              <span className="block text-xs text-slate-400">{preset.detail}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PeriodInput
          label="Check-in interval"
          hint="How often you must prove you are alive."
          seconds={value.interval}
          error={errors.interval}
          onChange={(interval) => onChange({ ...value, interval })}
        />
        <PeriodInput
          label="Grace period"
          hint="Extra time after a missed check-in."
          seconds={value.grace}
          error={errors.grace}
          onChange={(grace) => onChange({ ...value, grace })}
        />
      </div>
      {valid && (
        <p className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm text-slate-400">
          If you go silent, your executor can activate inheritance after{" "}
          <span className="font-semibold text-slate-200">{humanDuration(value.interval + value.grace)}</span>.
        </p>
      )}
    </div>
  );
}
