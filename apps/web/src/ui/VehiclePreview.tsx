import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { getVehicleModel } from "@lagos-living/shared";
import { useEffect, useRef, useState } from "react";
import { VehicleFactory, type VehicleView } from "../game/vehicles";

/** Turntable of the exact catalogue model and colour, built by the same code that draws it on the street. */
export function VehiclePreview({ modelId, colour }: { modelId: string; colour: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<{ factory: VehicleFactory; camera: ArcRotateCamera; view: VehicleView | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let engine: Engine;
    try {
      engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false }, false);
    } catch {
      setFailed(true);
      return;
    }
    engine.setHardwareScalingLevel(Math.max(1, 1.5 / (window.devicePixelRatio || 1)));
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.environmentTexture = new HDRCubeTexture("/assets/sky/daylight-1k.hdr", scene, 128, false, true, false, true);
    scene.environmentIntensity = 0.9;
    const camera = new ArcRotateCamera("dealer camera", -Math.PI / 4, 1.2, 8, new Vector3(0, 0.7, 0), scene);
    camera.fov = 0.6;
    camera.lowerBetaLimit = 0.6;
    camera.upperBetaLimit = 1.5;
    camera.lowerRadiusLimit = 2.5;
    camera.upperRadiusLimit = 14;
    camera.wheelDeltaPercentage = 0.01;
    camera.panningSensibility = 0;
    camera.useAutoRotationBehavior = true;
    camera.autoRotationBehavior!.idleRotationSpeed = 0.35;
    camera.attachControl(canvas, true);
    const sky = new HemisphericLight("dealer sky", new Vector3(0, 1, 0), scene);
    sky.intensity = 0.6;
    const key = new DirectionalLight("dealer key", new Vector3(-0.4, -0.8, 0.5), scene);
    key.intensity = 2.2;
    const floor = MeshBuilder.CreateDisc("showroom floor", { radius: 4.2, tessellation: 48 }, scene);
    floor.rotation.x = Math.PI / 2;
    const floorMaterial = new PBRMaterial("showroom floor", scene);
    floorMaterial.albedoColor = Color3.FromHexString("#d8d4cc");
    floorMaterial.roughness = 0.35;
    floor.material = floorMaterial;
    const glass = new PBRMaterial("preview glass", scene);
    glass.albedoColor = Color3.FromHexString("#1d2c2f");
    glass.roughness = 0.08;
    glass.alpha = 0.9;
    const chrome = new PBRMaterial("preview chrome", scene);
    chrome.albedoColor = Color3.FromHexString("#c9ccd0");
    chrome.metallic = 1;
    chrome.roughness = 0.15;
    let live = true;
    void VehicleFactory.load(scene, { glass, chrome }).then((factory) => {
      if (!live) return;
      stage.current = { factory, camera, view: null };
      setReady((count) => count + 1);
    });
    engine.runRenderLoop(() => scene.render());
    const resize = new ResizeObserver(() => engine.resize());
    resize.observe(canvas);
    return () => {
      live = false;
      resize.disconnect();
      stage.current = null;
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    current.view?.dispose();
    const model = getVehicleModel(modelId);
    current.view = current.factory.create(`preview-${modelId}`, modelId, colour);
    current.camera.radius = Math.max(3, model.length * 1.55 + 1);
    current.camera.target.y = model.height * 0.45;
  }, [modelId, colour, ready]);

  return (
    <div className="vehicle-preview" data-testid="vehicle-preview">
      <canvas ref={canvasRef} aria-label={`3D preview of the ${getVehicleModel(modelId).name}`} />
      {failed && <p className="preview-status">The 3D preview could not load on this device.</p>}
      <small>Drag to turn · pinch or scroll to zoom</small>
    </div>
  );
}
