import { useCallback, type CSSProperties } from "react";
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
import {
  SLOTS,
  type Configuration,
  type Finish,
  type Slot,
} from "@/lib/table-variants";

const DESCRIPTION = "Choose the shape and finish of the top and legs.";

type PanelProps = {
  configuration: Configuration;
  onVariantChange: (slot: Slot, variant: string) => void;
  onFinishChange: (slot: Slot, finish: string) => void;
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
// It takes at most half the screen, so the model keeps the other half; below
// the header, the controls scroll.
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
        style={{ "--drawer-content-max-height": "50dvh" } as CSSProperties}
        className="shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.15)]"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-3">
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
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <PanelControls {...props} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// A variant picker and a finish picker per slot, shared by both layouts.
function PanelControls({
  configuration,
  onVariantChange,
  onFinishChange,
}: Omit<PanelProps, "onReset">) {
  return SLOTS.map(({ slot, label, variants, finishes }) => {
    const variant = variants.find(
      ({ id }) => id === configuration.variants[slot],
    );
    const finish = finishes.find(
      ({ id }) => id === configuration.finishes[slot],
    );
    return (
      <div key={slot} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{label}</p>
          <p className="truncate text-muted-foreground">
            {variant?.label} · {finish?.label}
          </p>
        </div>
        <ToggleGroup
          aria-label={`${label} shape`}
          variant="outline"
          value={[configuration.variants[slot]]}
          onValueChange={(value) => {
            // Single choice: ignore the toggle-off of the current variant.
            if (value[0]) onVariantChange(slot, value[0] as string);
          }}
          className="grid w-full grid-cols-4"
        >
          {variants.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              aria-label={option.label}
              title={option.label}
              className="h-auto flex-col gap-1.5 px-1 py-2.5 text-xs"
            >
              <VariantIcon slot={slot} variant={option.id} className="size-10" />
              <span className="truncate">{option.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label={`${label} finish`}
          variant="outline"
          size="sm"
          value={[configuration.finishes[slot]]}
          onValueChange={(value) => {
            if (value[0]) onFinishChange(slot, value[0] as string);
          }}
          // Sized to their labels, which vary more than the shapes' do.
          className="flex w-full flex-wrap"
        >
          {finishes.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              aria-label={option.label}
              title={option.label}
              className="gap-2 px-2.5 text-xs"
            >
              <FinishSwatch finish={option} />
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    );
  });
}

// The finish's color as a chip; metals get a diagonal highlight, so they read
// as polished rather than painted.
function FinishSwatch({ finish }: { finish: Finish }) {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
      style={{
        backgroundColor: finish.color,
        backgroundImage:
          finish.metalness > 0
            ? "linear-gradient(135deg, rgb(255 255 255 / 0.65), transparent 45%, rgb(0 0 0 / 0.25))"
            : undefined,
      }}
    />
  );
}
