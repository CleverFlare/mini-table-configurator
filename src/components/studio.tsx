import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useThree } from "@react-three/fiber";
import {
  type DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  type Vector3Tuple,
} from "three";
import {
  PMREMGenerator,
  ShadowNodeMaterial,
  type WebGPURenderer,
} from "three/webgpu";

// Softbox panels as [position, [width, height], intensity], each facing the
// origin: a large overhead key, a softer front fill, rim lights for edge
// separation, then a back fill and floor bounce.
const SOFTBOXES: [Vector3Tuple, [number, number], number][] = [
  [[0, 5, 1], [8, 6], 5],
  [[0, 1, 6], [8, 3], 1.2],
  [[-5, 2, -3], [2, 6], 1.5],
  [[5, 2, -3], [2, 6], 1.5],
  [[0, 1, -6], [8, 4], 1.2],
  [[0, -4, 0], [8, 8], 0.6],
];

// Prefilters the softbox scene into the environment map. drei's Environment
// renders into a WebGL-only cube target, which WebGPURenderer ignores.
function StudioEnvironment() {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer;
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const geometry = new PlaneGeometry();
    const softboxes = new Scene();
    for (const [position, [width, height], intensity] of SOFTBOXES) {
      const material = new MeshBasicMaterial({
        side: DoubleSide,
        toneMapped: false,
      });
      material.color.multiplyScalar(intensity);
      const panel = new Mesh(geometry, material);
      panel.position.set(...position);
      panel.scale.set(width, height, 1);
      panel.lookAt(0, 0, 0);
      softboxes.add(panel);
    }

    const pmrem = new PMREMGenerator(gl);
    const target = pmrem.fromScene(softboxes);
    scene.environment = target.texture;
    // Frames render on demand, so ask for one with the new lighting.
    invalidate();

    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      geometry.dispose();
      softboxes.traverse((object) => {
        if (object instanceof Mesh) object.material.dispose();
      });
    };
  }, [gl, scene, invalidate]);

  return null;
}

// Renders the shadow map once the model has mounted, and again whenever
// `shadowKey` changes. The shadow light points straight down, so orbiting
// never changes the shadow; recomputing it every frame would only cost GPU
// time.
function RefreshShadow({
  light,
  shadowKey,
}: {
  light: DirectionalLight | null;
  shadowKey: unknown;
}) {
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    if (!light) return;
    light.shadow.needsUpdate = true;
    invalidate();
  }, [light, shadowKey, invalidate]);

  return null;
}

// Studio built locally, so nothing is fetched from a CDN. The hemisphere
// light and the softbox back fill and floor bounce lift shadowed areas so dark
// finishes keep their shape from every angle. Children stand on a floor at
// y = 0 that only shows their shadow; meshes need castShadow. Change
// `shadowKey` whenever the children's shape changes, to recompute the shadow.
export function Studio({
  children,
  shadowKey,
}: {
  children: ReactNode;
  shadowKey?: unknown;
}) {
  // drei's ContactShadows relies on ShaderMaterial, which WebGPURenderer
  // can't compile, so the floor is a transparent shadow catcher instead.
  const shadowCatcher = useMemo(
    () => new ShadowNodeMaterial({ opacity: 0.35 }),
    [],
  );
  const [shadowLight, setShadowLight] = useState<DirectionalLight | null>(
    null,
  );

  return (
    <>
      <hemisphereLight args={["#ffffff", "#d8d8d8", 0.6]} />
      <directionalLight position={[2, 5, 4]} intensity={1.5} />
      {/* Shadow only: straight down and adding no light, so the floor gets a
          soft contact shadow under the model. */}
      <directionalLight
        ref={setShadowLight}
        position={[0, 5, 0]}
        intensity={0}
        castShadow
        shadow-autoUpdate={false}
        // Covers the widest top with room for the blur, which is about 25 cm:
        // soft, like the shade under a tabletop lit from far above.
        shadow-mapSize={[256, 256]}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-radius={16}
        shadow-blurSamples={25}
        shadow-bias={-0.001}
      />
      <StudioEnvironment />
      <Suspense fallback={null}>
        {children}
        <mesh
          rotation-x={-Math.PI / 2}
          receiveShadow
          material={shadowCatcher}
        >
          <planeGeometry args={[10, 10]} />
        </mesh>
        {/* Inside the boundary, so it runs once the model is in. */}
        <RefreshShadow light={shadowLight} shadowKey={shadowKey} />
      </Suspense>
    </>
  );
}
