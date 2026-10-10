import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Culling/ray";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { useEffect, useRef, useState } from "react";
import { MultiplayerConnection, type MultiplayerStatus } from "./multiplayer";

type Direction = "forward" | "backward" | "left" | "right" | "run";
type InputState = Record<Direction, boolean>;
type Quality = "low" | "medium" | "high";

const initialInput: InputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  run: false,
};

function makeMaterial(scene: Scene, name: string, hex: string, specular = 0.08) {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(hex);
  result.specularColor = Color3.White().scale(specular);
  return result;
}

function createWorld(scene: Scene, shadows: ShadowGenerator) {
  const paving = makeMaterial(scene, "paving", "#b8ad8d");
  const roadMaterial = makeMaterial(scene, "asphalt", "#303b3d", 0.02);
  const water = makeMaterial(scene, "lagoon", "#147f82", 0.35);
  water.alpha = 0.9;
  const wallMaterials = [
    makeMaterial(scene, "warm render", "#d8d5c6"),
    makeMaterial(scene, "terracotta", "#b96748"),
    makeMaterial(scene, "glass", "#2e6973", 0.45),
  ];
  const green = makeMaterial(scene, "palm leaves", "#37724a");
  const bark = makeMaterial(scene, "palm bark", "#8a5b36");

  const ground = MeshBuilder.CreateGround("walkable-island", { width: 180, height: 125 }, scene);
  ground.material = paving;
  ground.checkCollisions = true;
  ground.receiveShadows = true;

  const lagoon = MeshBuilder.CreateGround("lagoon", { width: 240, height: 85 }, scene);
  lagoon.position.set(0, -0.24, 82);
  lagoon.material = water;

  // A collision-tested compound entrance demonstrates curb/stair traversal.
  for (let step = 0; step < 4; step += 1) {
    const stair = MeshBuilder.CreateBox(`compound-step-${step}`, {
      width: 6,
      depth: 1.2,
      height: 0.18 * (step + 1),
    }, scene);
    stair.position.set(30, 0.09 * (step + 1), -11 - step * 1.2);
    stair.material = paving;
    stair.checkCollisions = true;
  }
  const ramp = MeshBuilder.CreateBox("accessible-ramp", { width: 4, depth: 8, height: 0.3 }, scene);
  ramp.position.set(36, 0.15, -14);
  ramp.rotation.x = -0.06;
  ramp.material = paving;
  ramp.checkCollisions = true;

  for (let x = -75; x <= 75; x += 15) {
    const trunk = MeshBuilder.CreateCylinder(`palm-trunk-${x}`, {
      height: 5,
      diameterTop: 0.34,
      diameterBottom: 0.66,
      tessellation: 8,
    }, scene);
    trunk.position.set(x, 2.5, 13);
    trunk.material = bark;
    trunk.checkCollisions = true;
    shadows.addShadowCaster(trunk);
    const crown = MeshBuilder.CreateSphere(`palm-crown-${x}`, {
      diameterX: 4.6,
      diameterY: 1.3,
      diameterZ: 3.7,
      segments: 8,
    }, scene);
    crown.position.set(x, 5.2, 13);
    crown.material = green;
    shadows.addShadowCaster(crown);
  }

  return { roadMaterial, wallMaterials };
}

type OsmElement =
  | { type: "node"; id: number; lat: number; lon: number }
  | { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> };

async function createMappedIkoyi(
  scene: Scene,
  shadows: ShadowGenerator,
  roadMaterial: StandardMaterial,
  wallMaterials: StandardMaterial[],
) {
  const response = await fetch("/assets/world/ikoyi-starter.osm.json");
  if (!response.ok) throw new Error("Could not load the Ikoyi map extract.");
  const data = (await response.json()) as { elements: OsmElement[] };
  const nodes = new Map<number, { x: number; z: number }>();
  const centerLat = 6.4495;
  const centerLon = 3.43;
  const scale = 0.12;
  for (const element of data.elements) {
    if (element.type !== "node") continue;
    nodes.set(element.id, {
      x: (element.lon - centerLon) * 110_600 * scale,
      z: -(element.lat - centerLat) * 111_320 * scale,
    });
  }

  let roadCount = 0;
  let buildingCount = 0;
  for (const element of data.elements) {
    if (element.type !== "way" || !element.tags) continue;
    const points = element.nodes.map((id) => nodes.get(id)).filter((point) => point !== undefined);
    if (points.length < 2) continue;
    if (element.tags.highway) {
      const roadWidth =
        element.tags.highway === "primary" || element.tags.highway === "secondary"
          ? 1.4
          : element.tags.highway === "residential"
            ? 0.85
            : 0.55;
      for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1]!;
        const to = points[index]!;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.08) continue;
        const segment = MeshBuilder.CreateBox(`osm-road-${element.id}-${index}`, {
          width: roadWidth,
          depth: length,
          height: 0.12,
        }, scene);
        segment.position.set((from.x + to.x) / 2, 0.025, (from.z + to.z) / 2);
        segment.rotation.y = Math.atan2(dx, dz);
        segment.material = roadMaterial;
        segment.checkCollisions = true;
        segment.receiveShadows = true;
        roadCount += 1;
      }
    } else if (element.tags.building && points.length >= 4) {
      const minX = Math.min(...points.map(({ x }) => x));
      const maxX = Math.max(...points.map(({ x }) => x));
      const minZ = Math.min(...points.map(({ z }) => z));
      const maxZ = Math.max(...points.map(({ z }) => z));
      const width = maxX - minX;
      const depth = maxZ - minZ;
      if (width < 0.35 || depth < 0.35 || width > 35 || depth > 35) continue;
      const levels = Number(element.tags["building:levels"]);
      const height = Number.isFinite(levels) && levels > 0
        ? Math.min(18, levels * 1.1)
        : 1.8 + ((element.id % 7) * 0.55);
      const building = MeshBuilder.CreateBox(`osm-building-${element.id}`, {
        width,
        depth,
        height,
      }, scene);
      building.position.set((minX + maxX) / 2, height / 2, (minZ + maxZ) / 2);
      building.material = wallMaterials[element.id % wallMaterials.length]!;
      building.checkCollisions = true;
      building.receiveShadows = true;
      shadows.addShadowCaster(building);
      buildingCount += 1;
    }
  }
  return { roadCount, buildingCount };
}

async function createPlayer(
  scene: Scene,
  camera: ArcRotateCamera,
  shadows: ShadowGenerator,
  getInput: () => InputState,
  onTelemetry: (value: { x: number; z: number; speed: number; motion: string; fps: number }) => void,
) {
  const collider = MeshBuilder.CreateCapsule("player-collider", {
    height: 1.8,
    radius: 0.38,
    tessellation: 8,
  }, scene);
  collider.position.set(-10, 1, 0);
  collider.isVisible = false;
  collider.checkCollisions = true;
  collider.ellipsoid = new Vector3(0.42, 0.9, 0.42);
  collider.ellipsoidOffset = new Vector3(0, 0, 0);

  const imported = await SceneLoader.ImportMeshAsync(
    "",
    "/assets/characters/",
    "cesium-man.glb",
    scene,
  );
  const root = imported.meshes[0];
  if (!root) throw new Error("The development character did not contain a root mesh.");
  root.parent = collider;
  root.position.set(0, -0.9, 0);
  root.rotationQuaternion = null;
  root.rotation.y = Math.PI;
  imported.meshes.forEach((mesh) => {
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    shadows.addShadowCaster(mesh);
  });

  const locomotion = imported.animationGroups[0];
  if (locomotion) {
    locomotion.start(true, 0.8);
    locomotion.goToFrame(locomotion.from);
    locomotion.pause();
    locomotion.targetedAnimations.forEach(({ animation }) => {
      animation.enableBlending = true;
      animation.blendingSpeed = 0.08;
    });
  }

  camera.lockedTarget = collider;
  let speed = 0;
  let lastYaw = Math.PI;
  let movingLastFrame = false;
  let telemetryElapsed = 0;
  const direction = new Vector3();
  const displacement = new Vector3();

  const update = () => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
    const input = getInput();
    const forwardAmount = Number(input.forward) - Number(input.backward);
    const sideAmount = Number(input.right) - Number(input.left);
    const hasInput = forwardAmount !== 0 || sideAmount !== 0;
    const targetSpeed = hasInput ? (input.run ? 6.1 : 3.15) : 0;
    const rate = hasInput ? 8.5 : 11.5;
    speed = Scalar.Lerp(speed, targetSpeed, 1 - Math.exp(-rate * dt));
    if (speed < 0.025) speed = 0;

    if (hasInput) {
      const cameraForward = camera.getForwardRay().direction;
      cameraForward.y = 0;
      cameraForward.normalize();
      const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();
      direction
        .copyFrom(cameraForward)
        .scaleInPlace(forwardAmount)
        .addInPlace(cameraRight.scale(sideAmount))
        .normalize();
      const desiredYaw = Math.atan2(direction.x, direction.z);
      lastYaw += Math.atan2(Math.sin(desiredYaw - lastYaw), Math.cos(desiredYaw - lastYaw))
        * Math.min(1, dt * 10);
      root.rotation.y = lastYaw + Math.PI;
    }

    displacement.copyFrom(direction).scaleInPlace(speed * dt);
    displacement.y = -9.81 * dt;
    collider.moveWithCollisions(displacement);
    if (collider.position.y < -8 || Math.abs(collider.position.x) > 110 || Math.abs(collider.position.z) > 100) {
      collider.position.set(-10, 1, 0);
      speed = 0;
    }

    const moving = speed > 0.2;
    if (locomotion) {
      locomotion.speedRatio = Math.max(0.55, speed / 3.15);
      if (moving && !movingLastFrame) locomotion.play(true);
      if (!moving && movingLastFrame) {
        locomotion.goToFrame(locomotion.from);
        locomotion.pause();
      }
    }
    movingLastFrame = moving;
    telemetryElapsed += dt;
    if (telemetryElapsed > 0.15) {
      telemetryElapsed = 0;
      onTelemetry({
        x: collider.position.x,
        z: collider.position.z,
        speed,
        motion: speed > 4 ? "Running" : speed > 0.2 ? "Walking" : "Idle",
        fps: scene.getEngine().getFps(),
      });
    }
  };
  return { update, root };
}

export default function PlayableScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<InputState>({ ...initialInput });
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<Quality>("high");
  const [telemetry, setTelemetry] = useState({ x: -10, z: 0, speed: 0, motion: "Idle", fps: 0 });
  const [multiplayer, setMultiplayer] = useState<MultiplayerStatus>({ state: "connecting" });
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [remotePosition, setRemotePosition] = useState("");
  const engineRef = useRef<Engine | null>(null);
  const shadowsRef = useRef<ShadowGenerator | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
    engineRef.current = engine;
    const scene = new Scene(engine);
    scene.collisionsEnabled = true;
    scene.clearColor = Color4.FromHexString("#a7dbdeff");
    scene.ambientColor = Color3.FromHexString("#526e69");

    const camera = new ArcRotateCamera(
      "third-person-camera",
      -Math.PI / 2.8,
      Math.PI / 3.1,
      8,
      Vector3.Zero(),
      scene,
    );
    camera.lowerRadiusLimit = 3.2;
    camera.upperRadiusLimit = 12;
    camera.lowerBetaLimit = 0.7;
    camera.upperBetaLimit = 1.47;
    camera.wheelDeltaPercentage = 0.01;
    camera.checkCollisions = true;
    camera.collisionRadius = new Vector3(0.35, 0.35, 0.35);
    camera.attachControl(canvas, true);

    const sky = new HemisphericLight("sky", Vector3.Up(), scene);
    sky.intensity = 0.82;
    sky.groundColor = Color3.FromHexString("#47615c");
    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.25), scene);
    sun.position.set(45, 75, -35);
    sun.intensity = 1.55;
    const shadows = new ShadowGenerator(quality === "high" ? 2048 : 1024, sun);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 18;
    shadowsRef.current = shadows;
    const materials = createWorld(scene, shadows);
    let updatePlayer: () => void = () => undefined;
    let connection: MultiplayerConnection | undefined;
    let inputTimer: ReturnType<typeof setInterval> | undefined;
    const remotes = new Map<
      string,
      { anchor: TransformNode; targetX: number; targetZ: number; targetYaw: number }
    >();
    void createMappedIkoyi(scene, shadows, materials.roadMaterial, materials.wallMaterials)
      .then(() =>
        createPlayer(scene, camera, shadows, () => inputRef.current, (value) => {
          if (!disposed) {
            canvas.dataset.telemetry = JSON.stringify(value);
            setTelemetry(value);
          }
        }),
      )
      .then((player) => {
        if (!disposed) {
          updatePlayer = player.update;
          setLoading(false);
          connection = new MultiplayerConnection(
            (snapshot, ownSessionId) => {
              const active = new Set<string>();
              const remotePlayers = snapshot.players.filter(
                (networkPlayer) => networkPlayer.sessionId !== ownSessionId,
              );
              for (const networkPlayer of remotePlayers) {
                active.add(networkPlayer.sessionId);
                let remote = remotes.get(networkPlayer.sessionId);
                if (!remote) {
                  const anchor = new TransformNode(`remote-${networkPlayer.sessionId}`, scene);
                  anchor.position.set(networkPlayer.x, 0.9, networkPlayer.z);
                  player.root.clone(`remote-avatar-${networkPlayer.sessionId}`, anchor);
                  remote = {
                    anchor,
                    targetX: networkPlayer.x,
                    targetZ: networkPlayer.z,
                    targetYaw: networkPlayer.yaw,
                  };
                  remotes.set(networkPlayer.sessionId, remote);
                }
                remote.targetX = networkPlayer.x;
                remote.targetZ = networkPlayer.z;
                remote.targetYaw = networkPlayer.yaw;
              }
              for (const [sessionId, remote] of remotes) {
                if (active.has(sessionId)) continue;
                remote.anchor.dispose(false, true);
                remotes.delete(sessionId);
              }
              setOnlinePlayers(snapshot.players.filter(({ connected }) => connected).length);
              const firstRemote = remotePlayers[0];
              setRemotePosition(
                firstRemote ? `${firstRemote.x.toFixed(2)},${firstRemote.z.toFixed(2)}` : "",
              );
            },
            setMultiplayer,
          );
          void connection.connect();
          inputTimer = setInterval(() => {
            const cameraForward = camera.getForwardRay().direction;
            connection?.send({
              forward: Number(inputRef.current.forward) - Number(inputRef.current.backward),
              right: Number(inputRef.current.right) - Number(inputRef.current.left),
              run: inputRef.current.run,
              yaw: Math.atan2(cameraForward.x, cameraForward.z),
            });
          }, 50);
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.error(error);
          setLoading(false);
        }
      });

    const keyMap: Record<string, Direction> = {
      w: "forward",
      arrowup: "forward",
      s: "backward",
      arrowdown: "backward",
      a: "left",
      arrowleft: "left",
      d: "right",
      arrowright: "right",
      shift: "run",
    };
    const updateKey = (event: KeyboardEvent, value: boolean) => {
      const control = keyMap[event.key.toLowerCase()];
      if (!control) return;
      event.preventDefault();
      inputRef.current[control] = value;
      canvas.dataset.lastInput = `${control}:${value ? "down" : "up"}`;
    };
    const down = (event: KeyboardEvent) => updateKey(event, true);
    const up = (event: KeyboardEvent) => updateKey(event, false);
    const clear = () => Object.assign(inputRef.current, initialInput);
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", clear);

    engine.runRenderLoop(() => {
      updatePlayer();
      const interpolation = 1 - Math.exp(-12 * Math.min(engine.getDeltaTime() / 1000, 0.05));
      for (const remote of remotes.values()) {
        remote.anchor.position.x = Scalar.Lerp(remote.anchor.position.x, remote.targetX, interpolation);
        remote.anchor.position.z = Scalar.Lerp(remote.anchor.position.z, remote.targetZ, interpolation);
        remote.anchor.rotation.y +=
          Math.atan2(
            Math.sin(remote.targetYaw - remote.anchor.rotation.y),
            Math.cos(remote.targetYaw - remote.anchor.rotation.y),
          ) * interpolation;
      }
      scene.render();
    });
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      if (inputTimer) clearInterval(inputTimer);
      void connection?.disconnect();
      scene.dispose();
      engine.dispose();
      engineRef.current = null;
      shadowsRef.current = null;
    };
  }, []);

  function changeQuality(next: Quality) {
    setQuality(next);
    const ratio = next === "low" ? 1.75 : next === "medium" ? 1.25 : 1;
    engineRef.current?.setHardwareScalingLevel(ratio);
    if (shadowsRef.current) shadowsRef.current.getShadowMap()!.refreshRate = next === "low" ? 2 : 1;
  }

  function bindTouch(control: Direction) {
    return {
      onPointerDown: (event: React.PointerEvent) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        inputRef.current[control] = true;
      },
      onPointerUp: () => {
        inputRef.current[control] = false;
      },
      onPointerCancel: () => {
        inputRef.current[control] = false;
      },
    };
  }

  return (
    <div className="playable-scene">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Playable third-person Lagos development world"
      />
      {loading && <div className="scene-loading">Loading resident…</div>}
      <div className="movement-hud" aria-live="polite">
        <strong>{telemetry.motion}</strong>
        <span data-testid="player-position">
          {telemetry.x.toFixed(1)}, {telemetry.z.toFixed(1)}
        </span>
        <small>{telemetry.speed.toFixed(1)} m/s</small>
        <small>{Math.round(telemetry.fps)} fps</small>
      </div>
      <div
        className={`multiplayer-hud ${multiplayer.state}`}
        data-testid="multiplayer-status"
        data-remote-position={remotePosition}
      >
        <i />
        {multiplayer.state === "connected"
          ? `${onlinePlayers} online`
          : multiplayer.state === "connecting"
            ? "Joining city…"
            : multiplayer.reason}
      </div>
      <label className="graphics-control">
        Graphics
        <select value={quality} onChange={(event) => changeQuality(event.target.value as Quality)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <div className="desktop-help">WASD move · Shift run · Drag camera · Wheel zoom</div>
      <a
        className="osm-attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        Map data © OpenStreetMap contributors · ODbL
      </a>
      <div className="touch-controls" aria-label="Touch movement controls">
        <button className="touch-up" aria-label="Move forward" {...bindTouch("forward")}>▲</button>
        <button className="touch-left" aria-label="Move left" {...bindTouch("left")}>◀</button>
        <button className="touch-down" aria-label="Move backward" {...bindTouch("backward")}>▼</button>
        <button className="touch-right" aria-label="Move right" {...bindTouch("right")}>▶</button>
        <button className="touch-run" aria-label="Run" {...bindTouch("run")}>RUN</button>
      </div>
    </div>
  );
}
