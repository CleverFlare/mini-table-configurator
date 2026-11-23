import { useCallback } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VariantIcon } from "@/components/variant-icon";
import { useMediaQuery } from "@/hooks/use-media-query";
import { SLOTS, type Configuration, type Slot } from "@/lib/table-variants";

const DESCRIPTION = "Choose a top and legs.";

type PanelProps = {
  configuration: Configuration;
  onVariantChange: (slot: Slot, variant: string) => void;
  onReset: () => void;
};

// A card docked to the right on desktop; a bottom sheet on mobile, whose
// height is reported so the viewport can keep the model above it.
export function ConfiguratorPanel({
  onPeekChange,
  ...props
}: PanelProps & { onPeekChange: (height: number) => void }) {
  const isDesktop = useMediaQuery("(min-width: 48rem)");
  return isDesktop ? (
    <DesktopPanel {...props} />
  ) : (
    <MobileSheet {...props} onPeekChange={onPeekChange} />
  );
}

function DesktopPanel({ onReset, ...props }: PanelProps) {
  return (
    <Card
      aria-label="Customize"
      className="relative z-10 m-4 w-95 shrink-0 gap-0 p-0"
    >
      <CardHeader className="pt-4">
        <CardTitle>Customize</CardTitle>
        <CardDescription>{DESCRIPTION}</CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto py-4">
        <PanelControls {...props} />
      </CardContent>

      <CardFooter className="pb-(--card-spacing)">
        <Button variant="outline" onClick={onReset} className="w-full">
          <RotateCcwIcon data-icon="inline-start" />
          Reset all
        </Button>
      </CardFooter>
    </Card>
  );
}

// Always open and never dismissed, so the model stays interactive behind it.
// The controls are short enough to show in full, so it has a single height.
function MobileSheet({
  onReset,
  onPeekChange,
  ...props
}: PanelProps & { onPeekChange: (height: number) => void }) {
  // Re-measured whenever the sheet's size changes.
  const popupRef = useCallback(
    (popup: HTMLDivElement | null) => {
      if (!popup) return;
      const observer = new ResizeObserver(() =>
        onPeekChange(popup.offsetHeight),
      );
      observer.observe(popup);
      return () => observer.disconnect();
    },
    [onPeekChange],
  );

  return (
    <Drawer
      open
      modal={false}
      disablePointerDismissal
      // Swipes, Escape and the like never close it.
      onOpenChange={(open, details) => {
        if (!open) details.cancel();
      }}
    >
      <DrawerContent
        ref={popupRef}
        className="shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.15)]"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <DrawerTitle>Customize</DrawerTitle>
          <DrawerDescription className="sr-only">{DESCRIPTION}</DrawerDescription>
          <Button
            variant="secondary"
            size="sm"
            onClick={onReset}
            className="-mr-2.5"
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reset
          </Button>
        </div>
        <div className="flex flex-col gap-4 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <PanelControls {...props} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// A picker per slot, shared by both layouts.
function PanelControls({
  configuration,
  onVariantChange,
}: Omit<PanelProps, "onReset">) {
  return SLOTS.map(({ slot, label, variants }) => {
    const selected = variants.find(({ id }) => id === configuration[slot]);
    return (
      <div key={slot} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-medium">{label}</p>
          <p className="text-muted-foreground">{selected?.label}</p>
        </div>
        <ToggleGroup
          aria-label={label}
          variant="outline"
          value={[configuration[slot]]}
          onValueChange={(value) => {
            // Single choice: ignore the toggle-off of the current variant.
            if (value[0]) onVariantChange(slot, value[0] as string);
          }}
          className="grid w-full grid-cols-4"
        >
          {variants.map((variant) => (
            <ToggleGroupItem
              key={variant.id}
              value={variant.id}
              aria-label={variant.label}
              title={variant.label}
              className="h-auto flex-col gap-1.5 px-1 py-2.5 text-xs"
            >
              <VariantIcon slot={slot} variant={variant.id} className="size-10" />
              <span className="truncate">{variant.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    );
  });
}
