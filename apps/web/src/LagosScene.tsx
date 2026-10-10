import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { useEffect, useRef } from "react";

function material(scene: Scene, name: string, color: Color3, rough = 0.8) {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = color;
  value.specularColor = Color3.White().scale(1 - rough);
  return value;
}

function createDevelopmentWorld(scene: Scene) {
  const sand = material(scene, "warm paving", Color3.FromHexString("#cbbf99"));
  const asphalt = material(scene, "asphalt", Color3.FromHexString("#273234"));
  const water = material(scene, "lagoon", Color3.FromHexString("#137b7d"), 0.25);
  water.alpha = 0.88;
  const greenery = material(scene, "greenery", Color3.FromHexString("#397447"));
  const white = material(scene, "rendered walls", Color3.FromHexString("#d9ded7"));
  const coral = material(scene, "facade accent", Color3.FromHexString("#c86f4d"));
  const glass = material(scene, "window glass", Color3.FromHexString("#295f6b"), 0.15);

  const ground = MeshBuilder.CreateGround("island", { width: 180, height: 120 }, scene);
  ground.material = sand;

  const lagoon = MeshBuilder.CreateGround("lagoon", { width: 240, height: 80 }, scene);
  lagoon.position = new Vector3(0, -0.18, 80);
  lagoon.material = water;

  for (const [x, z, width, depth] of [
    [0, 5, 150, 12],
    [-35, -20, 10, 90],
    [42, -15, 9, 80],
  ] as const) {
    const road = MeshBuilder.CreateBox(`road-${x}-${z}`, { width, depth, height: 0.18 }, scene);
    road.position = new Vector3(x, 0.02, z);
    road.material = asphalt;
  }

  const blocks = [
    [-63, -38, 17, 16, 14, white],
    [-13, -37, 25, 16, 20, glass],
    [17, -34, 22, 20, 11, coral],
    [66, -30, 24, 18, 18, white],
    [-65, 30, 16, 24, 25, glass],
    [-10, 31, 24, 17, 13, white],
    [20, 29, 18, 16, 22, glass],
    [67, 31, 22, 21, 15, coral],
  ] as const;
  blocks.forEach(([x, z, width, depth, height, facade], index) => {
    const building = MeshBuilder.CreateBox(`development-building-${index}`, {
      width,
      depth,
      height,
    }, scene);
    building.position = new Vector3(x, height / 2, z);
    building.material = facade;
    building.receiveShadows = true;
  });

  for (let x = -75; x <= 75; x += 15) {
    const trunk = MeshBuilder.CreateCylinder(`palm-trunk-${x}`, {
      height: 5,
      diameterTop: 0.35,
      diameterBottom: 0.7,
    }, scene);
    trunk.position = new Vector3(x, 2.5, 13);
    trunk.material = coral;
    const crown = MeshBuilder.CreateSphere(`palm-crown-${x}`, {
      diameterX: 5,
      diameterY: 1.4,
      diameterZ: 4,
      segments: 8,
    }, scene);
    crown.position = new Vector3(x, 5.1, 13);
    crown.material = greenery;
  }
}

export default function LagosScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
    const scene = new Scene(engine);
    scene.clearColor = Color4.FromHexString("#a7dbdeff");
    scene.ambientColor = Color3.FromHexString("#63817d");

    const camera = new ArcRotateCamera(
      "preview-camera",
      -Math.PI / 2.8,
      Math.PI / 3.3,
      115,
      new Vector3(0, 4, 0),
      scene,
    );
    camera.lowerRadiusLimit = 45;
    camera.upperRadiusLimit = 150;
    camera.upperBetaLimit = Math.PI / 2.05;
    camera.wheelDeltaPercentage = 0.01;
    camera.attachControl(canvas, true);

    const skyLight = new HemisphericLight("sky-light", new Vector3(0, 1, 0), scene);
    skyLight.intensity = 1.25;
    skyLight.groundColor = Color3.FromHexString("#49605e");
    const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.25), scene);
    sun.position = new Vector3(50, 80, -40);
    sun.intensity = 2.3;
    const shadows = new ShadowGenerator(1024, sun);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 24;

    createDevelopmentWorld(scene);
    scene.meshes.forEach((mesh) => {
      if (mesh.name.startsWith("development-building") || mesh.name.startsWith("palm")) {
        shadows.addShadowCaster(mesh);
      }
    });

    engine.runRenderLoop(() => scene.render());
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      scene.dispose();
      engine.dispose();
    };
  }, []);

  return <canvas aria-label="Interactive Lagos development world preview" ref={canvasRef} />;
}
