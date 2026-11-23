// The table's configurable slots: the variants to swap between, whose ids
// match the `slot` and `variant` extras on the model's nodes, and the finishes
// for the slot's material, which every variant of the slot shares.

export const SLOTS = [
  {
    slot: "top",
    label: "Top",
    material: "Top_Finish",
    variants: [
      { id: "rectangle", label: "Rectangle" },
      { id: "capsule", label: "Capsule" },
      { id: "oval", label: "Oval" },
      { id: "round", label: "Round" },
    ],
    finishes: [
      { id: "oak", label: "Oak", color: "#c8a27a", roughness: 0.55, metalness: 0 },
      { id: "walnut", label: "Walnut", color: "#5a3a26", roughness: 0.45, metalness: 0 },
      { id: "marble", label: "White marble", color: "#ededea", roughness: 0.2, metalness: 0 },
      // Light passes through; see `isGlass`.
      { id: "glass", label: "Glass", color: "#f4f8f7", roughness: 0.05, metalness: 0, transmission: 1 },
    ],
  },
  {
    slot: "legs",
    label: "Legs",
    material: "Leg_Finish",
    variants: [
      { id: "four", label: "Four legs" },
      { id: "panel", label: "Panel" },
      { id: "pedestal", label: "Pedestal" },
      { id: "sled", label: "Sled" },
    ],
    finishes: [
      { id: "black", label: "Matte black", color: "#1a1a1a", roughness: 0.6, metalness: 0 },
      { id: "steel", label: "Brushed steel", color: "#b8b8b8", roughness: 0.35, metalness: 1 },
      { id: "brass", label: "Brass", color: "#c9a25e", roughness: 0.3, metalness: 1 },
    ],
  },
] as const;

export type Slot = (typeof SLOTS)[number]["slot"];

export type Finish = (typeof SLOTS)[number]["finishes"][number];

// Glass needs a transmissive material of its own; the other finishes only
// change the values of the slot's shared material.
export function isGlass(finish: Finish) {
  return "transmission" in finish;
}

export function findFinish(slot: Slot, id: string) {
  return SLOTS.find((entry) => entry.slot === slot)!.finishes.find(
    (finish: Finish) => finish.id === id,
  );
}

// The chosen variant and finish ids for each slot.
export type Configuration = {
  variants: Record<Slot, string>;
  finishes: Record<Slot, string>;
};

export const DEFAULT_CONFIGURATION: Configuration = {
  variants: { top: "rectangle", legs: "four" },
  finishes: { top: "oak", legs: "black" },
};
