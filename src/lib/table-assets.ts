import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import tableUrl from "@/assets/table_configurator.glb?url";
import { loadAsset } from "@/lib/asset-loader";

// The download starts when this module is first imported, before React
// mounts. The promise is stable, so components can suspend on it with `use`.

// The table's scene, every variant of every slot included. Each variant node
// carries its slot and variant name in its glTF extras, which three.js keeps
// in `userData`.
export const tableModel = loadAsset(tableUrl, "table_configurator.glb")
  .then((blob) => blob.arrayBuffer())
  .then((buffer) => new GLTFLoader().parseAsync(buffer, ""))
  .then((gltf) => gltf.scene);
