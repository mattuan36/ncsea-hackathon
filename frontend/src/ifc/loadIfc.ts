import * as THREE from 'three';
import { IfcAPI, type Color } from 'web-ifc';

export interface IfcScene {
  group: THREE.Group;
  dispose: () => void;
}

let apiPromise: Promise<IfcAPI> | null = null;
let loadQueue: Promise<unknown> = Promise.resolve();

function getIfcApi(): Promise<IfcAPI> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new IfcAPI();
      if (typeof window !== 'undefined') {
        api.SetWasmPath(`${import.meta.env.BASE_URL}web-ifc/`, true);
      }
      await api.Init(undefined, true);
      return api;
    })().catch((error: unknown) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = loadQueue.then(job, job);
  loadQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function colorKey(color: Color): string {
  return `${color.x.toFixed(3)}|${color.y.toFixed(3)}|${color.z.toFixed(3)}|${color.w.toFixed(3)}`;
}

function release(geometries: THREE.BufferGeometry[], materials: Map<string, THREE.Material>) {
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/** Build a Y-up group centered on the origin. IFC bytes are parsed on the shared wasm module. */
export function loadIfcScene(data: Uint8Array): Promise<IfcScene> {
  return enqueue(() => buildIfcScene(data));
}

async function buildIfcScene(data: Uint8Array): Promise<IfcScene> {
  const api = await getIfcApi();
  let modelID = -1;
  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.MeshLambertMaterial>();
  const group = new THREE.Group();

  try {
    modelID = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    if (modelID < 0) throw new Error('Could not open this IFC file.');

    const meshes = api.LoadAllGeometry(modelID);
    for (let i = 0; i < meshes.size(); i++) {
      const flat = meshes.get(i);
      const placed = flat.geometries;
      for (let j = 0; j < placed.size(); j++) {
        const place = placed.get(j);
        const source = api.GetGeometry(modelID, place.geometryExpressID);
        const verts = api.GetVertexArray(source.GetVertexData(), source.GetVertexDataSize());
        const indices = api.GetIndexArray(source.GetIndexData(), source.GetIndexDataSize());
        const usable = verts.length >= 6 && verts.length % 6 === 0 && indices.length >= 3;
        if (!usable) {
          source.delete();
          continue;
        }

        const position = new Float32Array(verts.length / 2);
        const normal = new Float32Array(verts.length / 2);
        for (let k = 0, p = 0; k < verts.length; k += 6, p += 3) {
          position[p] = verts[k];
          position[p + 1] = verts[k + 1];
          position[p + 2] = verts[k + 2];
          normal[p] = verts[k + 3];
          normal[p + 1] = verts[k + 4];
          normal[p + 2] = verts[k + 5];
        }
        const buffer = new THREE.BufferGeometry();
        buffer.setAttribute('position', new THREE.BufferAttribute(position, 3));
        buffer.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
        buffer.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        source.delete();
        geometries.push(buffer);

        const key = colorKey(place.color);
        let material = materials.get(key);
        if (!material) {
          material = new THREE.MeshLambertMaterial({
            color: new THREE.Color(place.color.x, place.color.y, place.color.z),
            opacity: place.color.w,
            transparent: place.color.w < 0.99,
            side: THREE.DoubleSide,
          });
          materials.set(key, material);
        }
        const mesh = new THREE.Mesh(buffer, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(place.flatTransformation);
        group.add(mesh);
      }
      if (typeof flat.delete === 'function') flat.delete();
    }
    const meshList = meshes as { delete?: () => void };
    if (typeof meshList.delete === 'function') meshList.delete();
  } catch (error) {
    release(geometries, materials);
    if (error instanceof Error && /no geometry to display/i.test(error.message)) throw error;
    throw new Error('Could not open this IFC file.');
  } finally {
    if (modelID >= 0) api.CloseModel(modelID);
  }

  if (group.children.length === 0) {
    release(geometries, materials);
    throw new Error('This IFC file has no geometry to display.');
  }

  // web-ifc placement matrices are already Y-up. A second Z-up rotation lays the building on its side.
  // Move the bounding-box center to the origin so a shared-coordinate site still frames in view.
  group.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  if (![center.x, center.y, center.z].every(Number.isFinite)) {
    release(geometries, materials);
    throw new Error('This IFC file has no geometry to display.');
  }
  group.position.sub(center);
  group.updateMatrixWorld(true);

  return {
    group,
    dispose() {
      release(geometries, materials);
    },
  };
}
