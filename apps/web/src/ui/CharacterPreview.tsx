import "@babylonjs/loaders/glTF";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Scene } from "@babylonjs/core/scene";
import type { CharacterAppearance } from "@lagos-living/shared";
import { useEffect, useRef, useState } from "react";
import { OUTFITS } from "../game/wardrobe";
import { AvatarFactory, type Avatar } from "../game/avatar";
import { capTextureSize, TOUCH_DEVICE } from "../game/device-limits";

/** Live 3D preview of the resident with the chosen look, using the same recolouring as the street. */
export function CharacterPreview({ appearance }: { appearance: CharacterAppearance }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<Avatar | null>(null);
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let disposed = false;
    let engine: Engine;
    try {
      engine = new Engine(canvas, !TOUCH_DEVICE, { stencil: false, preserveDrawingBuffer: false }, false);
    } catch {
      setState("failed");
      return;
    }
    capTextureSize(engine);
    // iOS drops a page's WebGL context under memory pressure, leaving only the panel's green backdrop behind. A lost
    // canvas can't make a new context, so the preview starts over on a fresh one once the page is showing.
    let rebuild: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      if (disposed || document.hidden) return;
      document.removeEventListener("visibilitychange", restart);
      rebuild = setTimeout(() => !disposed && setGeneration((value) => value + 1), 800);
    };
    engine.onContextLostObservable.add(() => {
      if (disposed) return;
      setState("loading");
      document.addEventListener("visibilitychange", restart);
      restart();
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.1;
    const camera = new ArcRotateCamera("preview camera", Math.PI / 2, 1.42, 3.7, new Vector3(0, 0.93, 0), scene);
    camera.fov = 0.62;
    camera.lowerRadiusLimit = 1.3;
    camera.upperRadiusLimit = 4.6;
    camera.lowerBetaLimit = 0.9;
    camera.upperBetaLimit = 1.75;
    camera.wheelDeltaPercentage = 0.01;
    camera.panningSensibility = 0;
    camera.attachControl(canvas, true);
    if (import.meta.env.DEV) {
      (window as unknown as { __previewView?: (alpha: number, beta: number, radius: number, y: number) => void }).__previewView = (alpha, beta, radius, y) => {
        camera.minZ = 0.05;
        camera.lowerRadiusLimit = 0.2;
        camera.lowerBetaLimit = 0.05;
        camera.upperBetaLimit = 3;
        camera.setTarget(new Vector3(0, y, 0));
        camera.alpha = alpha;
        camera.beta = beta;
        camera.radius = radius;
      };
    }
    const sky = new HemisphericLight("preview sky", new Vector3(0, 1, 0), scene);
    sky.intensity = 0.75;
    sky.groundColor = new Color3(0.35, 0.3, 0.26);
    const key = new DirectionalLight("preview key", new Vector3(-0.4, -0.7, 0.6), scene);
    key.intensity = 2.4;
    const rim = new DirectionalLight("preview rim", new Vector3(0.6, -0.3, -0.8), scene);
    rim.intensity = 1.1;
    let last = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      avatarRef.current?.update(0, "idle", dt);
      scene.render();
    });
    const resize = new ResizeObserver(() => engine.resize());
    resize.observe(canvas);
    AvatarFactory.load(scene)
      .then((factory) => {
        if (disposed) return;
        const avatar = factory.create("preview", appearanceRef.current);
        avatarRef.current = avatar;
        setState("ready");
      })
      .catch(() => !disposed && setState("failed"));
    return () => {
      disposed = true;
      clearTimeout(rebuild);
      document.removeEventListener("visibilitychange", restart);
      resize.disconnect();
      avatarRef.current = null;
      engine.dispose();
    };
  }, [generation]);

  useEffect(() => {
    avatarRef.current?.setAppearance(appearance);
  }, [appearance]);

  return (
    <div className="character-preview-3d" data-testid="character-preview" data-state={state}>
      <canvas key={generation} ref={canvasRef} aria-label="3D preview of your resident" />
      {state === "loading" && <p className="preview-status">Loading your resident…</p>}
      {state === "failed" && <p className="preview-status">The 3D preview could not load on this device. Your choices still save.</p>}
      <p className="preview-caption">{OUTFITS[appearance.outfit].label}</p>
      <small>Drag to turn · scroll to zoom</small>
    </div>
  );
}
