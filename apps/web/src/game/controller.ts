import { MOVEMENT, type MotionState } from "@lagos-living/shared";

export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "walk"
  | "interact"
  | "stop"
  | "phone"
  | "map"
  | "help"
  | "jump"
  | "lights"
  | "camera";

export type Bindings = Record<Action, string>;

export const defaultBindings: Bindings = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  sprint: "ShiftLeft",
  walk: "KeyC",
  interact: "KeyE",
  stop: "KeyQ",
  phone: "KeyP",
  map: "KeyM",
  help: "KeyH",
  jump: "Space",
  lights: "KeyL",
  camera: "KeyV",
};

export const actionLabels: Record<Action, string> = {
  forward: "Move forward",
  back: "Move back",
  left: "Move left",
  right: "Move right",
  sprint: "Sprint (hold)",
  walk: "Walk toggle",
  interact: "Interact",
  stop: "Request danfo stop",
  phone: "Phone",
  map: "Full map",
  help: "Controls help",
  jump: "Hop / handbrake",
  lights: "Vehicle lights",
  camera: "Switch vehicle camera",
};

export function keyLabel(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "Space") return "Space";
  return code.replace("Arrow", "↑").replace("Left", "").replace("Right", "");
}

/** Keyboard, mouse and touch state. Movement keys are read every frame; actions fire once. */
export class InputState {
  private down = new Set<string>();
  private pressed = new Set<Action>();
  enabled = true;
  walkToggle = false;
  lookDX = 0;
  lookDY = 0;
  zoom = 0;
  touchMove: [number, number] = [0, 0];
  touchSprint = false;
  /** On-screen pedals and steering while driving; null when not in use. */
  touchDrive: { throttle: number; brake: number; steer: number } | null = null;
  private dragging = false;
  private cleanup: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement, public bindings: Bindings) {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      const action = this.actionFor(event.code);
      if (action === "phone" || action === "map" || action === "help") {
        this.pressed.add(action);
        event.preventDefault();
        return;
      }
      if (!this.enabled) return;
      if (action && ["forward", "back", "left", "right", "jump", "sprint"].includes(action)) event.preventDefault();
      if (event.repeat) return;
      this.down.add(event.code);
      if (action === "walk") this.walkToggle = !this.walkToggle;
      if (action) this.pressed.add(action);
    };
    const onKeyUp = (event: KeyboardEvent) => this.down.delete(event.code);
    const onBlur = () => this.down.clear();
    const onHidden = () => document.hidden && this.down.clear();
    const onMouseMove = (event: MouseEvent) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || this.dragging) {
        this.lookDX += event.movementX;
        this.lookDY += event.movementY;
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!this.enabled) return;
      if (event.button === 0 || event.button === 2) this.dragging = true;
    };
    const onMouseUp = () => {
      this.dragging = false;
    };
    const onClick = () => {
      if (!this.enabled || document.pointerLockElement === canvas) return;
      if (matchMedia("(pointer: fine)").matches) {
        const request = canvas.requestPointerLock?.() as Promise<void> | undefined;
        request?.catch?.(() => undefined);
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!this.enabled) return;
      this.zoom += Math.sign(event.deltaY);
      event.preventDefault();
    };
    const onContext = (event: Event) => event.preventDefault();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    this.cleanup.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur),
      () => document.removeEventListener("visibilitychange", onHidden),
      () => window.removeEventListener("mousemove", onMouseMove),
      () => window.removeEventListener("mouseup", onMouseUp),
      () => canvas.removeEventListener("mousedown", onMouseDown),
      () => canvas.removeEventListener("click", onClick),
      () => canvas.removeEventListener("wheel", onWheel),
      () => canvas.removeEventListener("contextmenu", onContext),
    );
  }

  private actionFor(code: string): Action | null {
    for (const [action, bound] of Object.entries(this.bindings) as Array<[Action, string]>) {
      if (bound === code) return action;
    }
    if (code === "ArrowUp") return "forward";
    if (code === "ArrowDown") return "back";
    if (code === "ArrowLeft") return "left";
    if (code === "ArrowRight") return "right";
    if (code === "ShiftRight") return "sprint";
    return null;
  }

  held(action: Action) {
    if (!this.enabled) return false;
    if (this.down.has(this.bindings[action])) return true;
    const arrows: Partial<Record<Action, string>> = { forward: "ArrowUp", back: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", sprint: "ShiftRight" };
    return arrows[action] ? this.down.has(arrows[action]!) : false;
  }

  consume(action: Action) {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.down.clear();
      this.dragging = false;
      this.touchMove = [0, 0];
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  }

  /** Synthetic key state, used by the in-browser test harness. */
  simulate(code: string, isDown: boolean) {
    if (!isDown) {
      this.down.delete(code);
      return;
    }
    if (this.down.has(code)) return;
    this.down.add(code);
    const action = this.actionFor(code);
    if (action === "walk") this.walkToggle = !this.walkToggle;
    if (action) this.pressed.add(action);
  }

  dispose() {
    for (const off of this.cleanup) off();
  }
}

export type MoveMode = "walk" | "jog" | "sprint";

/** Frame-rate independent third-person locomotion with acceleration, turn rate and push-out collision. */
/**
 * Longest frame simulated at full length. Movement runs in 120 Hz substeps, so a
 * slow device (down to 1 fps) still moves at full speed; longer stalls, such as
 * a background tab, are cut short.
 */
export const MAX_FRAME_DT = 1;
/** Front crawl at an easy pace and flat out, in metres per second. */
export const SWIM_SPEED = { easy: 1.1, fast: 1.8 } as const;
export const SUBSTEP_DT = 1 / 120;

export class LocomotionController {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  yaw = 0;
  hop = 0;
  private hopVelocity = 0;
  mode: MoveMode = "jog";
  /** In a pool: moves at swimming pace. */
  swimming = false;

  constructor(private readonly collide: (x: number, z: number) => [number, number]) {}

  speed() {
    return Math.hypot(this.vx, this.vz);
  }

  motion(): MotionState {
    const speed = this.speed();
    if (speed < 0.1) return "idle";
    if (speed <= MOVEMENT.walkSpeed + 0.25) return "walk";
    if (speed <= MOVEMENT.jogSpeed + 0.4) return "jog";
    return "sprint";
  }

  teleport(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
  }

  jump() {
    if (this.hop <= 0.001) this.hopVelocity = 3.2;
  }

  step(dt: number, input: [number, number], cameraYaw: number, mode: MoveMode) {
    this.mode = mode;
    const length = Math.min(1, Math.hypot(input[0], input[1]));
    const maxSpeed = this.swimming
      ? mode === "sprint" ? SWIM_SPEED.fast : SWIM_SPEED.easy
      : mode === "sprint" ? MOVEMENT.sprintSpeed : mode === "walk" ? MOVEMENT.walkSpeed : MOVEMENT.jogSpeed;
    let tx = 0;
    let tz = 0;
    if (length > 0.05) {
      const fx = Math.sin(cameraYaw);
      const fz = Math.cos(cameraYaw);
      const rx = Math.cos(cameraYaw);
      const rz = -Math.sin(cameraYaw);
      const dx = fx * input[1] + rx * input[0];
      const dz = fz * input[1] + rz * input[0];
      const d = Math.hypot(dx, dz) || 1;
      tx = (dx / d) * maxSpeed * length;
      tz = (dz / d) * maxSpeed * length;
    }
    const ex = tx - this.vx;
    const ez = tz - this.vz;
    const error = Math.hypot(ex, ez);
    if (error > 0) {
      const speeding = Math.hypot(tx, tz) >= this.speed() - 0.01;
      const rate = (speeding ? MOVEMENT.acceleration : MOVEMENT.deceleration) * dt;
      const k = Math.min(1, rate / error);
      this.vx += ex * k;
      this.vz += ez * k;
    }
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    const [cx, cz] = this.collide(nx, nz);
    // Remove only the velocity into whatever we hit so we slide along walls instead of sticking.
    // A push-out moves the resident but never becomes speed: 0.3 m in one 1/120 s substep would
    // otherwise read as 36 m/s and run away when squeezed between a car and a wall.
    const pushX = cx - nx;
    const pushZ = cz - nz;
    const push = Math.hypot(pushX, pushZ);
    if (push > 1e-4) {
      const into = (this.vx * pushX + this.vz * pushZ) / push;
      if (into < 0) {
        this.vx -= (pushX / push) * into;
        this.vz -= (pushZ / push) * into;
      }
    }
    this.x = cx;
    this.z = cz;
    if (this.speed() > 0.15) {
      const target = Math.atan2(this.vx, this.vz);
      let delta = target - this.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.yaw += delta * (1 - Math.exp(-MOVEMENT.turnRate * dt));
    }
    if (this.hop > 0 || this.hopVelocity > 0) {
      this.hop += this.hopVelocity * dt;
      this.hopVelocity -= 9.8 * dt;
      if (this.hop <= 0) {
        this.hop = 0;
        this.hopVelocity = 0;
      }
    }
  }
}
