import type { ReactNode } from "react";
import type { Slot } from "@/lib/table-variants";

// The top, under the legs icons.
const TOP_EDGE = <rect x="5" y="11" width="38" height="4" rx="1" />;

// Tops drawn from above, to scale with each other (25 units a meter); legs
// drawn from the table's short end, which tells them apart best.
const ICONS: Record<Slot, Record<string, ReactNode>> = {
  top: {
    rectangle: <rect x="6.5" y="13.4" width="35" height="21.2" rx="1.5" />,
    capsule: <rect x="4" y="12.75" width="40" height="22.5" rx="11.25" />,
    oval: <ellipse cx="24" cy="24" rx="20" ry="11.9" />,
    round: <circle cx="24" cy="24" r="16.25" />,
  },
  legs: {
    four: (
      <>
        {TOP_EDGE}
        <path d="M11 15 12 41M37 15 36 41" />
      </>
    ),
    panel: (
      <>
        {TOP_EDGE}
        <rect x="10" y="15" width="28" height="26" />
      </>
    ),
    pedestal: (
      <>
        {TOP_EDGE}
        <path d="M24 15v23" />
        <rect x="13" y="38" width="22" height="3" rx="1.5" />
      </>
    ),
    sled: (
      <>
        {TOP_EDGE}
        <path d="M11 15v22a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V15" />
      </>
    ),
  },
};

// A line drawing of a variant, in the text color.
export function VariantIcon({
  slot,
  variant,
  className,
}: {
  slot: Slot;
  variant: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {ICONS[slot][variant]}
    </svg>
  );
}
