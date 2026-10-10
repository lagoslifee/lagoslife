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
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { useEffect, useRef, useState } from "react";

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

  for (const [x, z, width, depth] of [
    [0, 5, 150, 12],
    [-36, -20, 10, 90],
    [43, -15, 9, 80],
  ] as const) {
    const road = MeshBuilder.CreateBox(`road-${x}-${z}`, { width, depth, height: 0.16 }, scene);
    road.position.set(x, 0.02, z);
    road.material = roadMaterial;
    road.checkCollisions = true;
    road.receiveShadows = true;
  }

  const buildings = [
    [-64, -39, 17, 17, 14, 0],
    [-14, -38, 24, 16, 20, 2],
    [17, -35, 21, 18, 11, 1],
    [67, -31, 23, 18, 18, 0],
    [-65, 31, 16, 22, 25, 2],
    [-10, 31, 23, 17, 13, 0],
    [20, 30, 18, 16, 22, 2],
    [68, 31, 22, 20, 15, 1],
  ] as const;
  buildings.forEach(([x, z, width, depth, height, style], index) => {
    const building = MeshBuilder.CreateBox(`development-building-${index}`, {
      width,
      depth,
      height,
    }, scene);
    building.position.set(x, height / 2, z);
    building.material = wallMaterials[style]!;
    building.checkCollisions = true;
    building.receiveShadows = true;
    shadows.addShadowCaster(building);
  });

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
  collider.position.set(0, 1, -2);
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

  return () => {
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
      collider.position.set(0, 1, -2);
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
}

export default function PlayableScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<InputState>({ ...initialInput });
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<Quality>("high");
  const [telemetry, setTelemetry] = useState({ x: 0, z: -2, speed: 0, motion: "Idle", fps: 0 });
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
    createWorld(scene, shadows);
    let updatePlayer: () => void = () => undefined;
    void createPlayer(scene, camera, shadows, () => inputRef.current, (value) => {
      if (!disposed) {
        canvas.dataset.telemetry = JSON.stringify(value);
        setTelemetry(value);
      }
    })
      .then((update) => {
        if (!disposed) {
          updatePlayer = update;
          setLoading(false);
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
      <label className="graphics-control">
        Graphics
        <select value={quality} onChange={(event) => changeQuality(event.target.value as Quality)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <div className="desktop-help">WASD move · Shift run · Drag camera · Wheel zoom</div>
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
