import { useLayoutEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  Color,
  DoubleSide,
  HalfFloatType,
  type Mesh,
  OrthographicCamera,
  RenderTarget,
  type Scene,
  type Texture,
  Vector2,
} from "three";
import {
  MeshBasicNodeMaterial,
  NodeMaterial,
  QuadMesh,
  type WebGPURenderer,
} from "three/webgpu";
import {
  positionWorld,
  saturate,
  texture,
  uv,
  vec2,
  vec4,
} from "three/tsl";

// Side of the floor square the shadow covers, in meters, centered under the
// model: the widest top with room for the blur.
const SIZE = 3;

// Two bakes, combined on the floor. A soft one for the whole model, mostly the
// top's shade, and a tight one for the parts that touch the floor; a single
// blur would either sharpen the top's shadow or wash out the feet. Each
// surface darkens the floor more the closer it is to it, fading to nothing at
// `height` (m); `blur` is the Gaussian's sigma (m) and `strength` its darkest.
const LAYERS = [
  { height: 1.2, blur: 0.1, resolution: 128, strength: 0.45 },
  { height: 0.15, blur: 0.008, resolution: 1024, strength: 0.9 },
];

// 9 taps, two steps per sigma. Each bake blurs twice, so the taps' copies of
// the hard-edged source merge into a smooth falloff; two passes of sigma make
// one of sigma * √2, so each pass uses sigma / √2.
const BLUR_ITERATIONS = 2;
const TAPS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const WEIGHTS = (() => {
  const raw = TAPS.map((i) => Math.exp(-(i * i) / 8));
  const total = raw.reduce((sum, w) => sum + w, 0);
  return raw.map((w) => w / total);
})();

// One pass of a separable Gaussian blur from `source`, `step` apart in UV.
function blurPass(source: Texture, step: Vector2) {
  const material = new NodeMaterial();
  material.fragmentNode = TAPS.map((i, index) =>
    texture(source, uv().add(vec2(step.x * i, step.y * i))).mul(
      WEIGHTS[index],
    ),
  ).reduce((sum, sample) => sum.add(sample));
  return new QuadMesh(material);
}

function createLayer({
  height,
  blur,
  resolution,
}: (typeof LAYERS)[number]) {
  const options = { type: HalfFloatType };
  const target = new RenderTarget(resolution, resolution, options);
  const scratch = new RenderTarget(resolution, resolution, options);

  // On the floor, looking up: image right is +x and image up is +z.
  const camera = new OrthographicCamera(
    -SIZE / 2,
    SIZE / 2,
    SIZE / 2,
    -SIZE / 2,
    0,
    height + 0.01,
  );
  camera.position.y = -0.01;
  camera.rotation.x = Math.PI / 2;

  // Every surface in range, seen through each other and alpha-composited, so
  // a part over another darkens the floor further.
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  material.fragmentNode = vec4(
    0,
    0,
    0,
    saturate(positionWorld.y.div(height).oneMinus()),
  );

  const sigma = blur / SIZE / Math.SQRT2;
  const blurX = blurPass(target.texture, new Vector2(sigma / 2, 0));
  const blurY = blurPass(scratch.texture, new Vector2(0, sigma / 2));

  return { target, scratch, camera, material, blurX, blurY };
}

type Layer = ReturnType<typeof createLayer>;

function bake(
  renderer: WebGPURenderer,
  scene: Scene,
  floor: Mesh,
  layers: Layer[],
) {
  const previousTarget = renderer.getRenderTarget();
  const previousOverride = scene.overrideMaterial;
  const previousClearColor = renderer.getClearColor(new Color());
  const previousClearAlpha = renderer.getClearAlpha();

  floor.visible = false;
  renderer.setClearColor(0x000000, 0);
  for (const layer of layers) {
    scene.overrideMaterial = layer.material;
    renderer.setRenderTarget(layer.target);
    renderer.render(scene, layer.camera);
    scene.overrideMaterial = previousOverride;

    for (let i = 0; i < BLUR_ITERATIONS; i++) {
      renderer.setRenderTarget(layer.scratch);
      layer.blurX.render(renderer);
      renderer.setRenderTarget(layer.target);
      layer.blurY.render(renderer);
    }
  }

  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousClearColor, previousClearAlpha);
  floor.visible = true;
}

// A soft contact shadow on the floor at y = 0, from everything else in the
// scene. Baked into textures when it mounts and whenever `bakeKey` changes,
// rather than every frame; mount it once the model is in the scene.
export function ContactShadow({ bakeKey }: { bakeKey: unknown }) {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer;
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const [floor, setFloor] = useState<Mesh | null>(null);

  const layers = useMemo(() => LAYERS.map(createLayer), []);
  useLayoutEffect(
    () => () => {
      for (const layer of layers) {
        layer.target.dispose();
        layer.scratch.dispose();
        layer.material.dispose();
        (layer.blurX.material as NodeMaterial).dispose();
        (layer.blurY.material as NodeMaterial).dispose();
      }
    },
    [layers],
  );

  // Both bakes, darkening the floor together: the layers' shadows combine
  // like two dark films, never past black.
  const floorMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    const light = LAYERS.map(({ strength }, index) =>
      texture(layers[index].target.texture).a.mul(strength).oneMinus(),
    ).reduce((lit, layer) => lit.mul(layer));
    material.fragmentNode = vec4(0, 0, 0, light.oneMinus());
    return material;
  }, [layers]);
  useLayoutEffect(() => () => floorMaterial.dispose(), [floorMaterial]);

  // Before paint, after the model's own layout effects, so the bake sees the
  // configuration being committed.
  useLayoutEffect(() => {
    if (!floor) return;
    bake(gl, scene, floor, layers);
    invalidate();
  }, [gl, scene, floor, layers, bakeKey, invalidate]);

  // Flipped, so the texture's +z, its image up, runs along the floor's +z.
  return (
    <mesh
      ref={setFloor}
      rotation-x={-Math.PI / 2}
      scale={[1, -1, 1]}
      material={floorMaterial}
    >
      <planeGeometry args={[SIZE, SIZE]} />
    </mesh>
  );
}
