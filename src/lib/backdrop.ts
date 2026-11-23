import { Vector2 } from "three";
import type { Node } from "three/webgpu";
import {
  float,
  length,
  min,
  mix,
  screenUV,
  select,
  sRGBTransferEOTF,
  uniform,
  vec3,
} from "three/tsl";

// The page's backdrop, `radial-gradient(ellipse at center, #fff 0%, #f3f3f3
// 55%, #e2e2e2 100%)`, drawn in the scene so it lands on the CSS colors
// exactly: the renderer tone maps the whole frame, so each color is the value
// that the tone mapping turns back into the CSS one.

const STOPS = [1, 243 / 255, 226 / 255];
const MIDPOINT = 0.55;

// Kept current by the studio: the canvas's and the page's CSS size, and the
// renderer's exposure.
export const backdropUniforms = {
  canvasSize: uniform(new Vector2(1, 1)),
  pageSize: uniform(new Vector2(1, 1)),
  exposure: uniform(1),
};

// The inverse of three's NeutralToneMapping for grays, whose desaturation
// step is then a no-op: the linear value, before exposure, that the tone
// mapping turns into `target`. Its curve only approaches white, so the target
// stops just short of it.
function inverseNeutralGray(target: Node<"float">) {
  const t = min(target, 0.9995);
  const compressed = float(0.52).add(float(0.0576).div(t.oneMinus()));
  return select(t.lessThan(0.76), t, compressed)
    .add(0.04)
    .div(backdropUniforms.exposure);
}

// The backdrop at this pixel, dimmed by `shade` (0 to 1) as if a shadow were
// composited over the CSS gradient. The gradient is laid out over the page,
// of which the canvas is the top-left part.
export function backdropColor(shade: Node<"float"> = float(0)) {
  const { canvasSize, pageSize } = backdropUniforms;
  // As CSS lays out `ellipse at center`: 0 at the page's center, 1 at its
  // corners.
  const pixel = screenUV.mul(canvasSize);
  const distance = min(length(pixel.div(pageSize).sub(0.5)).mul(Math.SQRT2), 1);
  const [center, middle, edge] = STOPS;
  const srgb = select(
    distance.lessThan(MIDPOINT),
    mix(float(center), float(middle), distance.div(MIDPOINT)),
    mix(float(middle), float(edge), distance.sub(MIDPOINT).div(1 - MIDPOINT)),
  );
  const linear = (sRGBTransferEOTF(vec3(srgb)) as ReturnType<typeof vec3>).x;
  return vec3(inverseNeutralGray(linear.mul(shade.oneMinus())));
}
