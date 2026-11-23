import {
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { addAfterEffect, Canvas, useThree } from "@react-three/fiber";
import {
  MathUtils,
  NeutralToneMapping,
  Vector3,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "@react-three/drei";
import signature from "@/assets/my-signature.svg";
import { Studio } from "@/components/studio";
import { ConfiguratorPanel } from "@/components/configurator-panel";
import { InstallPrompt } from "@/components/install-prompt";
import { LoadingOverlay } from "@/components/loading-overlay";
import { tableModel } from "@/lib/table-assets";
import { firstFrameRendered, shadersProgress } from "@/lib/load-stages";
import {
  DEFAULT_CONFIGURATION,
  SLOTS,
  type Configuration,
  type Slot,
} from "@/lib/table-variants";

type VariantTag = { slot?: Slot; variant?: string };

// Every variant is in the scene; swapping one only flips which is visible.
// Each slot's variants share one material, so a finish is applied once to
// that material.
function Table({ configuration }: { configuration: Configuration }) {
  const { variants, finishes } = configuration;
  const scene = use(tableModel);
  const invalidate = useThree((state) => state.invalidate);

  // The model's materials by name.
  const materials = useMemo(() => {
    const byName = new Map<string, MeshStandardMaterial>();
    scene.traverse((object) => {
      const material = (object as Mesh).material as
        | MeshStandardMaterial
        | undefined;
      if (material?.name) byName.set(material.name, material);
    });
    return byName;
  }, [scene]);

  // Before paint, so the first frame, the shader compile and the shadow bake
  // see the right variants.
  useLayoutEffect(() => {
    scene.traverse((object) => {
      const { slot, variant } = object.userData as VariantTag;
      if (slot && variant) object.visible = variants[slot] === variant;
    });
    invalidate();
  }, [scene, variants, invalidate]);

  // The renderer reads these values from the material every frame, so a
  // finish change is a uniform update, never a shader recompile.
  useLayoutEffect(() => {
    for (const { slot, material, finishes: options } of SLOTS) {
      const target = materials.get(material);
      const finish = options.find(({ id }) => id === finishes[slot]);
      if (!target || !finish) continue;
      target.color.set(finish.color);
      target.roughness = finish.roughness;
      target.metalness = finish.metalness;
    }
    invalidate();
  }, [materials, finishes, invalidate]);

  return <primitive object={scene} />;
}

// Mounted beside the model, so it runs once the model is in the scene:
// compiles every shader up front, hidden variants included so swapping one in
// never stalls, reporting progress, then marks the first frame drawn after
// that, when the model is actually on screen.
function ReportSceneReady() {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer;
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    let cancelled = false;
    let removeAfterEffect: (() => void) | undefined;
    // The compile collects the visible objects synchronously, so the hidden
    // ones only need showing for the call itself.
    const hidden: Object3D[] = [];
    scene.traverse((object) => {
      if (!object.visible) hidden.push(object);
    });
    for (const object of hidden) object.visible = true;
    const compiled = gl.compileAsync(scene, camera, null, (event) =>
      shadersProgress(event.loaded, event.total),
    );
    for (const object of hidden) object.visible = false;
    void compiled.then(() => {
      if (cancelled) return;
      removeAfterEffect = addAfterEffect(() => {
        firstFrameRendered();
        removeAfterEffect?.();
      });
      invalidate();
    });
    return () => {
      cancelled = true;
      removeAfterEffect?.();
    };
  }, [gl, scene, camera, invalidate]);

  return null;
}

// The orbit centers on the table's middle, about halfway up its 72 cm height,
// and starts from the front, slightly to the right and above.
const CAMERA_TARGET = new Vector3(0, 0.38, 0);
const CAMERA_START = new Vector3(1.1, 1.25, 2.4);
const CAMERA_DISTANCE = CAMERA_START.distanceTo(CAMERA_TARGET);
// Reach of the widest top from the center, with a margin. The table is wider
// than it is tall, so on a portrait view the camera's distance is set by width
// rather than height.
const TABLE_HALF_WIDTH = 1;

// Keeps the orbit direction, only moving the camera along it.
function FitCamera() {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const aspect = useThree((state) => state.size.width / state.size.height);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const halfFov = MathUtils.degToRad(camera.fov / 2);
    const widthDistance = TABLE_HALF_WIDTH / (Math.tan(halfFov) * aspect);
    const offset = camera.position.clone().sub(CAMERA_TARGET);
    offset.setLength(Math.max(CAMERA_DISTANCE, widthDistance));
    camera.position.copy(CAMERA_TARGET).add(offset);
    invalidate();
  }, [camera, aspect, invalidate]);

  return null;
}

function App() {
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIGURATION);
  // Height of the mobile sheet, kept clear below the viewport.
  const [sheetPeek, setSheetPeek] = useState(0);

  return (
    <div
      className="flex h-dvh w-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_center,#ffffff_0%,#f3f3f3_55%,#e2e2e2_100%)] pb-(--sheet-peek) md:flex-row md:pb-0"
      style={{ "--sheet-peek": `${sheetPeek}px` } as CSSProperties}
    >
      <main className="relative min-h-0 flex-1">
        <header className="pointer-events-none absolute top-0 left-0 z-10 flex flex-col gap-1.5 pt-[max(env(safe-area-inset-top),1.25rem)] pl-[max(env(safe-area-inset-left),1.25rem)] md:pt-8 md:pl-8">
          <p className="pl-[0.3em] text-[0.625rem] font-medium tracking-[0.25em] text-muted-foreground uppercase md:text-[0.6875rem]">
            Made by
          </p>
          {/* The signature is a mask over the text color, so it follows the
              theme and stays sharp at any size. Its width follows the
              viewport, and the height too, so it stays small on phones held
              sideways. */}
          <span
            role="img"
            aria-label="Muhammad Maher"
            className="aspect-[2504/520] w-[clamp(7rem,min(12vw,28vh),11.5rem)] bg-foreground/80 mask-contain mask-center mask-no-repeat"
            style={{ maskImage: `url(${signature})` }}
          />
        </header>
        <div className="absolute top-0 right-0 z-10 pt-[max(env(safe-area-inset-top),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] md:pt-8 md:pr-8">
          <InstallPrompt />
        </div>
        <Canvas
          camera={{ position: CAMERA_START.toArray(), fov: 45 }}
          // The scene only changes on orbit, swap or resize, so frames render
          // on demand rather than 60 times a second.
          frameloop="demand"
          // No shadow maps: the floor's shadow is baked separately. An object
          // keeps R3F from setting PCFSoftShadowMap, which WebGPU lacks.
          shadows={{ enabled: false }}
          // WebGPU where available, otherwise its WebGL 2 backend; both run TSL.
          gl={async (props) => {
            const renderer = new WebGPURenderer(
              props as ConstructorParameters<typeof WebGPURenderer>[0],
            );
            await renderer.init();
            return renderer;
          }}
          // Set after creation, since R3F applies its own tone mapping default
          // to renderers built by a factory.
          onCreated={({ gl }) => {
            gl.toneMapping = NeutralToneMapping;
            gl.toneMappingExposure = 1.2;
          }}
        >
          {/* Finishes don't change the shadow, so only variants re-bake it. */}
          <Studio shadowKey={configuration.variants}>
            <Table configuration={configuration} />
            <ReportSceneReady />
          </Studio>
          <OrbitControls
            makeDefault
            target={CAMERA_TARGET.toArray()}
            // Stops just above the floor, which only exists as a shadow.
            maxPolarAngle={MathUtils.degToRad(85)}
            minDistance={1.2}
            maxDistance={6}
          />
          <FitCamera />
        </Canvas>
      </main>
      <ConfiguratorPanel
        configuration={configuration}
        onVariantChange={(slot, variant) =>
          setConfiguration((current) => ({
            ...current,
            variants: { ...current.variants, [slot]: variant },
          }))
        }
        onFinishChange={(slot, finish) =>
          setConfiguration((current) => ({
            ...current,
            finishes: { ...current.finishes, [slot]: finish },
          }))
        }
        onReset={() => setConfiguration(DEFAULT_CONFIGURATION)}
        onPeekChange={setSheetPeek}
      />
      <LoadingOverlay />
    </div>
  );
}

export default App;
