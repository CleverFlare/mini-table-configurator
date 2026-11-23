import {
  Color,
  DataTexture,
  RepeatWrapping,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";
import {
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type WebGPURenderer,
} from "three/webgpu";
import { normalMap, texture, uniform, uv, vec2 } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import tableUrl from "@/assets/table_configurator.glb?url";
import oakColorUrl from "@/assets/textures/oak_color.ktx2?url";
import oakRoughnessUrl from "@/assets/textures/oak_roughness.ktx2?url";
import oakNormalUrl from "@/assets/textures/oak_normal.ktx2?url";
import walnutColorUrl from "@/assets/textures/walnut_color.ktx2?url";
import walnutRoughnessUrl from "@/assets/textures/walnut_roughness.ktx2?url";
import walnutNormalUrl from "@/assets/textures/walnut_normal.ktx2?url";
import marbleColorUrl from "@/assets/textures/marble_color.ktx2?url";
import averages from "@/assets/textures/textures.json";
import { loadAsset } from "@/lib/asset-loader";
import { SLOTS, isGlass, type Finish } from "@/lib/table-variants";

// Downloads start when this module is first imported, before React mounts.
// The promises are stable, so components can suspend on them with `use`.

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
      // About the top's 3 cm, for the refraction's offset.
      thickness: 0.03,
      // Smoked: through that thickness, light keeps this color, a dark gray
      // with a hint of green. It has to be this dark to show at all over the
      // backdrop, whose near-white is far brighter than white once the tone
      // mapping is undone.
      attenuationColor: new Color("#6a706e"),
      attenuationDistance: 0.03,
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

// The KTX2 textures are transcoded to whichever compressed format the GPU
// supports, which needs the initialized renderer; the canvas hands it over.
// The loader brings its own transcoder, which the build bundles.
let provideRenderer!: (renderer: WebGPURenderer) => void;
const ktx2Loader = new Promise<WebGPURenderer>(
  (resolve) => (provideRenderer = resolve),
).then((renderer) => new KTX2Loader().detectSupport(renderer));

// Call once the renderer has finished `init()`.
export function setTableRenderer(renderer: WebGPURenderer) {
  provideRenderer(renderer);
}

// Downloads at once, transcodes once the renderer is ready. Each file's
// transfer function sets its color space: sRGB for color, linear for data.
function loadTexture(url: string) {
  const name = url.split("/").pop()!.split("?")[0];
  return Promise.all([
    loadAsset(url, name).then((blob) => blob.arrayBuffer()),
    ktx2Loader,
  ]).then(
    ([buffer, ktx2]) =>
      new Promise<Texture>((resolve, reject) =>
        ktx2.parse(
          buffer,
          (texture) => {
            texture.wrapS = texture.wrapT = RepeatWrapping;
            // The top is mostly seen at a slant.
            texture.anisotropy = 8;
            resolve(texture);
          },
          reject,
        ),
      ),
  );
}

// A finish's maps, from scripts/build-textures.sh, which also measured their
// averages. `tile` is the side, in meters, that one copy of them covers; the
// model's UVs are in meters.
export type FinishTextures = {
  color: Texture;
  roughness?: Texture;
  normal?: Texture;
  tile: number;
  average: { color: string; roughness?: number };
};

async function loadFinishTextures(
  urls: { color: string; roughness?: string; normal?: string },
  tile: number,
  average: FinishTextures["average"],
): Promise<FinishTextures> {
  const [color, roughness, normal] = await Promise.all([
    loadTexture(urls.color),
    urls.roughness ? loadTexture(urls.roughness) : undefined,
    urls.normal ? loadTexture(urls.normal) : undefined,
  ]);
  return { color, roughness, normal, tile, average };
}

// Keyed by finish id. Every one is loaded up front, so a finish swaps in at
// once, like the shapes. The veneers' tiles are their real size, per Poly
// Haven, wider than any top, so no seam shows; the marble's is chosen to
// suit its veining.
export const finishTextures: Promise<Record<string, FinishTextures>> =
  Promise.all([
    loadFinishTextures(
      { color: oakColorUrl, roughness: oakRoughnessUrl, normal: oakNormalUrl },
      1.83,
      averages.oak,
    ),
    loadFinishTextures(
      {
        color: walnutColorUrl,
        roughness: walnutRoughnessUrl,
        normal: walnutNormalUrl,
      },
      1.8,
      averages.walnut,
    ),
    loadFinishTextures({ color: marbleColorUrl }, 1.4, averages.marble),
  ]).then(([oak, walnut, marble]) => ({ oak, walnut, marble }));

// 1×1 stand-ins for a finish without a map: white, which leaves the
// material's own value as it is, and a flat normal.
function pixel(r: number, g: number, b: number) {
  const texture = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}
const WHITE = pixel(255, 255, 255);
const FLAT_NORMAL = pixel(128, 128, 255);

// A slot's material for finishes with maps. Each map is a texture node whose
// texture is swapped and each value a uniform, so a finish change never
// recompiles the shader.
export class TexturedFinishMaterial extends MeshStandardNodeMaterial {
  private tile = uniform(1);
  // Multiplies the maps, so their averages come out at the finish's color
  // and roughness.
  private tint = uniform(new Color(1, 1, 1));
  private roughnessScale = uniform(1);
  private maps;

  constructor(source: MeshStandardMaterial) {
    super({ name: source.name, side: source.side, metalness: 0 });
    // Centered on the model, u along its length, x, and v along its depth.
    const surface = uv().sub(vec2(0, 1)).div(this.tile).add(0.5);
    this.maps = {
      color: texture(WHITE, surface),
      roughness: texture(WHITE, surface),
      normal: texture(FLAT_NORMAL, surface),
    };
    this.colorNode = this.maps.color.rgb.mul(this.tint);
    // Roughness is gray, so any channel reads it.
    this.roughnessNode = this.maps.roughness.g.mul(this.roughnessScale);
    // glTF's UVs run down the image, where three.js expects them up, so
    // y flips, as GLTFLoader does for normal maps without stored tangents.
    this.normalNode = normalMap(this.maps.normal.rgb, vec2(1, -1));
  }

  setFinish(finish: Finish, textures?: FinishTextures) {
    this.maps.color.value = textures?.color ?? WHITE;
    this.maps.roughness.value = textures?.roughness ?? WHITE;
    this.maps.normal.value = textures?.normal ?? FLAT_NORMAL;
    this.tile.value = textures?.tile ?? 1;

    // In linear light, channel by channel.
    const tint = this.tint.value.set(finish.color);
    if (textures) {
      const average = new Color(textures.average.color);
      tint.setRGB(tint.r / average.r, tint.g / average.g, tint.b / average.b);
    }
    const roughness = textures?.roughness && textures.average.roughness;
    this.roughnessScale.value = finish.roughness / (roughness || 1);
    this.metalness = finish.metalness;
  }
}

// The top's finishes have maps, so its meshes share a textured material in
// place of the model's own, under the same name.
function addTexturedMaterials(scene: Object3D) {
  const top = SLOTS.find(({ slot }) => slot === "top")!;
  const replacements = new Map<MeshStandardMaterial, TexturedFinishMaterial>();
  scene.traverse((object) => {
    const mesh = object as Mesh;
    const material = mesh.material as MeshStandardMaterial | undefined;
    if (!mesh.isMesh || material?.name !== top.material) return;
    if (!replacements.has(material)) {
      replacements.set(material, new TexturedFinishMaterial(material));
    }
    mesh.material = replacements.get(material)!;
  });
  for (const material of replacements.keys()) material.dispose();
}

// The table's scene, every variant of every slot included. Each variant node
// carries its slot and variant name in its glTF extras, which three.js keeps
// in `userData`.
export const tableModel = loadAsset(tableUrl, "table_configurator.glb")
  .then((blob) => blob.arrayBuffer())
  .then((buffer) => new GLTFLoader().parseAsync(buffer, ""))
  .then((gltf) => {
    addTexturedMaterials(gltf.scene);
    addGlassTwins(gltf.scene);
    return gltf.scene;
  });
