// The table's swappable slots and their variants. Ids match the `slot` and
// `variant` extras on the model's nodes.

export const SLOTS = [
  {
    slot: "top",
    label: "Top",
    variants: [
      { id: "rectangle", label: "Rectangle" },
      { id: "capsule", label: "Capsule" },
      { id: "oval", label: "Oval" },
      { id: "round", label: "Round" },
    ],
  },
  {
    slot: "legs",
    label: "Legs",
    variants: [
      { id: "four", label: "Four legs" },
      { id: "panel", label: "Panel" },
      { id: "pedestal", label: "Pedestal" },
      { id: "sled", label: "Sled" },
    ],
  },
] as const;

export type Slot = (typeof SLOTS)[number]["slot"];

// The chosen variant id for each slot.
export type Configuration = Record<Slot, string>;

export const DEFAULT_CONFIGURATION: Configuration = {
  top: "rectangle",
  legs: "four",
};
