import { useState } from "react";
import { sameAddress, shortAddress } from "../lib/format.js";

const OTHER = "__other__";

/**
 * Pick a person by name from the ChainWill address book, or paste any address.
 * Calls onChange(address, name|null).
 */
export function PartyPicker({ id, value, onChange, directory = [], exclude = [], placeholder = "Choose a person…", disabled }) {
  const options = directory.filter((u) => !exclude.some((x) => sameAddress(x, u.address)) || sameAddress(u.address, value));
  const known = options.find((u) => sameAddress(u.address, value));
  const [custom, setCustom] = useState(Boolean(value) && !known);

  const select = (event) => {
    const choice = event.target.value;
    if (choice === OTHER) {
      setCustom(true);
      onChange("", null);
      return;
    }
    setCustom(false);
    const person = options.find((u) => u.address === choice);
    onChange(choice, person?.name ?? null);
  };

  return (
    <div className="space-y-2">
      <select id={id} className="input" value={custom ? OTHER : known ? known.address : ""} onChange={select} disabled={disabled}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((u) => (
          <option key={u.address} value={u.address}>
            {u.name} — {shortAddress(u.address)}
            {u.walletMode === "metamask" ? " (MetaMask)" : ""}
          </option>
        ))}
        <option value={OTHER}>Other wallet address…</option>
      </select>
      {custom && (
        <input
          className="input mono"
          placeholder="0x…"
          value={value}
          onChange={(e) => onChange(e.target.value.trim(), null)}
          aria-label="Wallet address"
          spellCheck={false}
          disabled={disabled}
        />
      )}
    </div>
  );
}
