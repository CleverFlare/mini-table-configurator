import { Color, type Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import tableUrl from "@/assets/table_configurator.glb?url";
import { loadAsset } from "@/lib/asset-loader";
import { SLOTS, isGlass } from "@/lib/table-variants";

// The download starts when this module is first imported, before React
// mounts. The promise is stable, so components can suspend on it with `use`.

// How dark a glass part's floor shadow is, relative to an opaque one's.
const GLASS_SHADOW_OPACITY = 0.3;

// Switching a material to transmission recompiles its shader, so glass gets a
// material of its own and each of the slot's meshes a glass twin sharing its
// geometry, hidden until the glass finish is chosen. Every mesh of the slot is
// tagged `glass: true | false`, so the right one of each pair can be shown.
function addGlassTwins(scene: Object3D) {
  for (const { material, finishes } of SLOTS) {
    const finish = finishes.find(isGlass);
    if (!finish) continue;

    const glass = new MeshPhysicalNodeMaterial({
      name: `${material}_Glass`,
      color: finish.color,
      roughness: finish.roughness,
      metalness: finish.metalness,
      transmission: 1,
      ior: 1.5,
      // About the top's 3 cm, for the refraction's offset; seen edge on, the
      // longer path through the glass shows its green tint.
      thickness: 0.03,
      attenuationColor: new Color("#c3dbd2"),
      attenuationDistance: 0.4,
    });

    const originals: Mesh[] = [];
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh && (mesh.material as MeshStandardMaterial).name === material) {
        originals.push(mesh);
      }
    });
    for (const original of originals) {
      glass.side = (original.material as MeshStandardMaterial).side;
      const twin = original.clone();
      twin.name = `${original.name}_Glass`;
      twin.material = glass;
      twin.userData.glass = true;
      twin.userData.shadowOpacity = GLASS_SHADOW_OPACITY;
      original.userData.glass = false;
      original.parent!.add(twin);
    }
  }
}

// The table's scene, every variant of every slot included. Each variant node
// carries its slot and variant name in its glTF extras, which three.js keeps
// in `userData`.
export const tableModel = loadAsset(tableUrl, "table_configurator.glb")
  .then((blob) => blob.arrayBuffer())
  .then((buffer) => new GLTFLoader().parseAsync(buffer, ""))
  .then((gltf) => {
    addGlassTwins(gltf.scene);
    return gltf.scene;
  });
