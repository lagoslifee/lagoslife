import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Bone } from "@babylonjs/core/Bones/bone";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAppearance } from "@lagos-living/shared";
import type { Accessory, Hairstyle } from "./appearance";

/**
 * Hairstyles and accessories are built in "head units": the origin is the Head joint, +Y points to the
 * `head_end` joint at distance 1, and +Z points out of the face.
 */
/** Cranium of resident-v1, measured from its head vertices; the eyes sit near y 0.5 and the nose tip at z 0.3. */
const SKULL = { centre: new Vector3(0, 0.72, -0.24), radius: 0.4 };
const EYES = { y: 0.52, z: 0.26, apart: 0.15 };

type Templates = Partial<Record<Hairstyle | Accessory, Mesh | null>>;
const templates = new WeakMap<Scene, Templates>();

function material(scene: Scene, name: string, hex: string, roughness: number) {
  const result = new PBRMaterial(`style ${name}`, scene);
  result.albedoColor = Color3.FromHexString(hex);
  result.metallic = 0;
  result.roughness = roughness;
  return result;
}

/** Deterministic points spread over a sphere (golden-angle spiral). */
function spherePoints(count: number) {
  const points: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index + 0.5) * (2 / count);
    const radius = Math.sqrt(1 - y * y);
    const angle = index * 2.399963;
    points.push(new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return points;
}

function strand(scene: Scene, from: Vector3, direction: Vector3, length: number, diameter: number, taper = 0.8) {
  const mesh = CreateCylinder("strand", { height: length, diameterTop: diameter, diameterBottom: diameter * taper, tessellation: 6 }, scene);
  const axis = direction.normalizeToNew();
  const rotation = Quaternion.FromUnitVectorsToRef(Vector3.Up(), axis, new Quaternion());
  mesh.rotationQuaternion = rotation;
  mesh.position = from.add(axis.scale(length / 2));
  return mesh;
}

function merged(meshes: Mesh[], name: string) {
  const mesh = Mesh.MergeMeshes(meshes, true, true)!;
  mesh.name = name;
  mesh.setEnabled(false);
  mesh.isPickable = false;
  return mesh;
}

/** Directions from the cranium centre that grow hair: not the forehead and face, not below the nape. */
function onScalp(point: Vector3) {
  return point.y > -0.2 && !(point.z > 0.55 && point.y < 0.45);
}

function build(scene: Scene, style: Hairstyle | Accessory): Mesh | null {
  const hair = () => material(scene, "hair", "#17120f", 0.85);
  const { centre, radius } = SKULL;
  switch (style) {
    case "afro": {
      const mesh = CreateSphere("afro", { diameter: radius * 2.6, segments: 14 }, scene);
      mesh.scaling = new Vector3(1.05, 0.9, 1);
      mesh.position = centre.add(new Vector3(0, 0.14, -0.08));
      mesh.material = hair();
      return merged([mesh], "hair afro");
    }
    case "twists": {
      const parts = spherePoints(90)
        .filter((point) => point.y > 0.05 && onScalp(point))
        .map((point) => strand(scene, centre.add(point.scale(radius * 0.9)), point.add(new Vector3(0, 0.6, 0)), 0.26, 0.075));
      const fill = hair();
      parts.forEach((part) => (part.material = fill));
      return merged(parts, "hair twists");
    }
    case "locs":
    case "braids": {
      const long = style === "braids";
      const parts = spherePoints(long ? 120 : 80)
        .filter((point) => point.y > -0.1 && onScalp(point) && point.z < 0.5)
        .map((point) => {
          const hang = new Vector3(point.x * 0.45, -1, Math.min(point.z, 0) * 0.4 - 0.12);
          return strand(scene, centre.add(point.scale(radius * 0.95)), hang, long ? 1.7 : 1.05, long ? 0.05 : 0.085, 0.9);
        });
      const cap = CreateSphere("scalp", { diameter: radius * 2.1, segments: 10, slice: 0.55 }, scene);
      cap.position = centre.clone();
      parts.push(cap);
      const fill = hair();
      parts.forEach((part) => (part.material = fill));
      return merged(parts, `hair ${style}`);
    }
    case "glasses": {
      const frame = material(scene, "glasses", "#1b1b1d", 0.35);
      const { y, z, apart } = EYES;
      const lenses = [-1, 1].map((side) => {
        const ring = CreateTorus("lens", { diameter: 0.21, thickness: 0.028, tessellation: 18 }, scene);
        ring.rotation.x = Math.PI / 2;
        ring.position = new Vector3(side * apart, y, z);
        return ring;
      });
      const bridge = CreateCylinder("bridge", { height: apart * 2 - 0.21, diameter: 0.025, tessellation: 6 }, scene);
      bridge.rotation.z = Math.PI / 2;
      bridge.position = new Vector3(0, y + 0.02, z);
      const arms = [-1, 1].map((side) => {
        const arm = CreateCylinder("arm", { height: 0.42, diameter: 0.025, tessellation: 6 }, scene);
        arm.rotation.x = Math.PI / 2;
        arm.position = new Vector3(side * 0.33, y + 0.02, z - 0.2);
        return arm;
      });
      const parts = [...lenses, bridge, ...arms];
      parts.forEach((part) => (part.material = frame));
      return merged(parts, "glasses");
    }
    case "cap": {
      const fabric = material(scene, "cap", "#b0262f", 0.9);
      const crown = CreateSphere("crown", { diameter: radius * 2.42, segments: 14, slice: 0.5 }, scene);
      crown.scaling = new Vector3(1, 1, 1.1);
      crown.position = centre.add(new Vector3(0, -0.04, 0.02));
      const brim = CreateCylinder("brim", { height: 0.03, diameter: 0.62, tessellation: 18 }, scene);
      brim.scaling = new Vector3(1, 1, 0.7);
      brim.position = new Vector3(0, centre.y - 0.03, 0.34);
      const parts = [crown, brim];
      parts.forEach((part) => (part.material = fabric));
      return merged(parts, "cap");
    }
    case "headwrap": {
      const fabric = material(scene, "headwrap", "#d4572a", 0.8);
      const wrap = CreateSphere("wrap", { diameter: radius * 2.4, segments: 14 }, scene);
      wrap.scaling = new Vector3(1, 0.9, 1.1);
      wrap.position = centre.add(new Vector3(0, 0.22, -0.08));
      const band = CreateTorus("band", { diameter: radius * 2.25, thickness: 0.12, tessellation: 24 }, scene);
      band.scaling = new Vector3(1, 1, 1.12);
      band.rotation.x = -0.3;
      band.position = centre.add(new Vector3(0, 0.08, -0.04));
      const knot = CreateSphere("knot", { diameter: 0.3, segments: 8 }, scene);
      knot.position = centre.add(new Vector3(0, 0.56, 0.14));
      const parts = [wrap, band, knot];
      parts.forEach((part) => (part.material = fabric));
      return merged(parts, "headwrap");
    }
    default:
      return null;
  }
}

function template(scene: Scene, style: Hairstyle | Accessory) {
  let cache = templates.get(scene);
  if (!cache) templates.set(scene, (cache = {}));
  if (!(style in cache)) cache[style] = build(scene, style);
  return cache[style] ?? null;
}

/**
 * Head frame at the bind pose: up runs from the Head to the head_end bone, right along the shoulders. It is
 * attached to the Head bone in skinning space (bone final matrix × mesh world), where the body is drawn.
 */
export function headAnchor(scene: Scene, name: string, mesh: AbstractMesh, bones: { head: Bone; top: Bone; leftShoulder: Bone; rightShoulder: Bone }) {
  mesh.computeWorldMatrix(true);
  bones.head.getSkeleton().prepare(true);
  const worldOf = (bone: Bone) => bone.getFinalMatrix().multiply(mesh.getWorldMatrix());
  const headWorld = worldOf(bones.head);
  const origin = headWorld.getTranslation();
  const upVector = worldOf(bones.top).getTranslation().subtract(origin);
  const size = upVector.length();
  const up = upVector.normalize();
  const across = worldOf(bones.rightShoulder).getTranslation().subtract(worldOf(bones.leftShoulder).getTranslation());
  const forward = Vector3.Cross(across, up).normalize();
  const right = Vector3.Cross(up, forward).normalize();
  const frame = Matrix.Compose(new Vector3(size, size, size), Quaternion.FromRotationMatrix(Matrix.FromXYZAxesToRef(right, up, forward, new Matrix())), origin);
  const local = frame.multiply(Matrix.Invert(headWorld));
  const anchor = new TransformNode(`${name} head style`, scene);
  anchor.scaling = new Vector3();
  anchor.rotationQuaternion = new Quaternion();
  anchor.position = new Vector3();
  local.decompose(anchor.scaling, anchor.rotationQuaternion, anchor.position);
  anchor.attachToBone(bones.head, mesh);
  return anchor;
}

/** Replaces the hairstyle and accessory meshes under a head anchor. */
export function dressHead(scene: Scene, anchor: TransformNode, appearance: CharacterAppearance) {
  for (const child of anchor.getChildMeshes(true)) child.dispose();
  const covered = appearance.accessory === "cap" || appearance.accessory === "headwrap";
  const styles: Array<Hairstyle | Accessory> = [];
  if (!(covered && (appearance.hairstyle === "afro" || appearance.hairstyle === "twists"))) styles.push(appearance.hairstyle);
  styles.push(appearance.accessory);
  for (const style of styles) {
    const source = template(scene, style);
    if (!source) continue;
    const mesh = source.clone(`${anchor.name} ${style}`, anchor)!;
    mesh.setEnabled(true);
    mesh.isPickable = false;
  }
}
