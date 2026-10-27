import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmButton, ProgressBar, StatusChip } from "../components/ui.jsx";
import { PartyPicker } from "../components/PartyPicker.jsx";
import { PlanProgress } from "../components/PlanProgress.jsx";
import { SplitPreview } from "../components/AssetModals.jsx";
import { LifecycleTimer } from "../components/will.jsx";
import { setChainNow } from "../lib/clock.js";

const BOB = "0x22d491Bde2303f2f43325b2108D26f1eAbA1e32b";
const CAROL = "0xE11BA2b4D45Eaed5996Cd0823791E0C93114882d";
const directory = [
  { address: BOB, name: "Bob", walletMode: "demo" },
  { address: CAROL, name: "Carol", walletMode: "metamask" },
];

describe("StatusChip", () => {
  it.each([
    ["ACTIVE", "Active"],
    ["MISSED", "Check-in missed"],
    ["ELIGIBLE", "Eligible for inheritance"],
    ["ACTIVATED", "Inheritance activated"],
    ["FULLY_CLAIMED", "Fully claimed"],
    ["REVOKED", "Revoked"],
  ])("labels %s as “%s”", (phase, label) => {
    render(<StatusChip phase={phase} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("clamps to 0–100", () => {
    const { rerender } = render(<ProgressBar value={1.3} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    rerender(<ProgressBar value={-1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    rerender(<ProgressBar value={0.6} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });
});

describe("LifecycleTimer", () => {
  const will = { phase: "ACTIVE", activated: false, lastCheckIn: 1000, checkInInterval: 120, gracePeriod: 60, checkInDeadline: 1120, graceDeadline: 1180 };

  it("counts down to the check-in deadline on the chain's clock", () => {
    setChainNow(1018);
    render(<LifecycleTimer will={will} compact />);
    expect(screen.getByRole("timer")).toHaveTextContent("01:42");
    expect(screen.getByText("until the next check-in is due")).toBeInTheDocument();
  });

  it("switches to the grace period, then to eligible", () => {
    setChainNow(1150);
    const { unmount } = render(<LifecycleTimer will={will} compact />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:30");
    expect(screen.getByText("of grace period left")).toBeInTheDocument();
    unmount();

    setChainNow(1200);
    render(<LifecycleTimer will={will} compact />);
    expect(screen.getByRole("timer")).toHaveTextContent("Eligible");
  });
});

describe("PartyPicker", () => {
  it("picks a person by name and reports their address", async () => {
    const onChange = vi.fn();
    render(<PartyPicker value="" onChange={onChange} directory={directory} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), BOB);
    expect(onChange).toHaveBeenCalledWith(BOB, "Bob");
  });

  it("hides excluded wallets", () => {
    render(<PartyPicker value="" onChange={() => {}} directory={directory} exclude={[BOB.toLowerCase()]} />);
    expect(screen.queryByRole("option", { name: /Bob/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Carol/ })).toHaveTextContent("(MetaMask)");
  });

  it("accepts a pasted address", async () => {
    const onChange = vi.fn();
    // the picker is a controlled input, so give it a parent that holds the value
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <PartyPicker
          value={value}
          directory={directory}
          onChange={(address, name) => {
            setValue(address);
            onChange(address, name);
          }}
        />
      );
    }
    render(<Harness />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "__other__");
    expect(onChange).toHaveBeenLastCalledWith("", null);
    await userEvent.type(screen.getByLabelText("Wallet address"), "0xabc");
    expect(onChange).toHaveBeenLastCalledWith("0xabc", null);
  });
});

describe("ConfirmButton", () => {
  it("asks before running a destructive action", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton onConfirm={onConfirm} confirmLabel="Yes, revoke my will">
        Revoke will
      </ConfirmButton>
    );
    await userEvent.click(screen.getByRole("button", { name: "Revoke will" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yes, revoke my will" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("can be cancelled", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton onConfirm={onConfirm}>Delete</ConfirmButton>);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("PlanProgress", () => {
  const steps = [
    { id: "a", label: "Create the will on-chain", status: "done", txHash: "0x" + "ab".repeat(32) },
    { id: "b", label: "Add Carol with 60%", status: "failed", txHash: null },
    { id: "c", label: "Deposit 10 ETH into escrow", status: "pending", txHash: null },
  ];

  it("shows progress and the contract's revert reason", () => {
    const error = Object.assign(new Error("Total percentage exceeds 100"), { reverted: true });
    render(<PlanProgress steps={steps} error={error} />);
    expect(screen.getByText(/1 of 3 transactions confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The smart contract rejected this step");
    expect(screen.getByRole("alert")).toHaveTextContent("Total percentage exceeds 100");
  });

  it("renders nothing for an empty plan", () => {
    const { container } = render(<PlanProgress steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SplitPreview", () => {
  const beneficiaries = [
    { address: BOB, name: "Bob", percentage: 60 },
    { address: CAROL, name: "Carol", percentage: 30 },
  ];

  it("shows each share and the unallocated remainder", () => {
    render(<SplitPreview amount="10" unit="ETH" beneficiaries={beneficiaries} totalPercentage={90} />);
    expect(screen.getByText("6 ETH")).toBeInTheDocument();
    expect(screen.getByText("3 ETH")).toBeInTheDocument();
    expect(screen.getByText("Remaining unallocated: 10%")).toBeInTheDocument();
  });

  it("renders nothing without an amount", () => {
    const { container } = render(<SplitPreview amount="" unit="ETH" beneficiaries={beneficiaries} totalPercentage={90} />);
    expect(container).toBeEmptyDOMElement();
  });
});
