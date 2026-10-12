import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

export type SignStyle = "street" | "shop" | "rent" | "sale" | "bus" | "plate" | "danfo" | "club";

export type UvRect = { u0: number; v0: number; u1: number; v1: number };

/** A busy district streams in 60–90 distinct signs at once, so the atlas holds twice that. */
const WIDTH = 2048;
const HEIGHT = 4096;
const SLOT_W = 512;
const SLOT_H = 96;
const COLUMNS = WIDTH / SLOT_W;
const ROWS = Math.floor(HEIGHT / SLOT_H);

const palettes: Record<SignStyle, { bg: string; fg: string; border?: string; font: string }> = {
  street: { bg: "#0d5b3b", fg: "#ffffff", border: "#ffffff", font: "600 40px Inter, Arial, sans-serif" },
  shop: { bg: "#f6efe2", fg: "#1f2a24", font: "800 46px Inter, Arial, sans-serif" },
  rent: { bg: "#d9332b", fg: "#ffffff", font: "900 44px Inter, Arial, sans-serif" },
  sale: { bg: "#1b4fa0", fg: "#ffffff", font: "900 44px Inter, Arial, sans-serif" },
  bus: { bg: "#f2c230", fg: "#1a1a1a", font: "800 38px Inter, Arial, sans-serif" },
  plate: { bg: "#1f2422", fg: "#f4e9c9", font: "700 36px Inter, Arial, sans-serif" },
  danfo: { bg: "#151515", fg: "#ffcf3a", font: "800 42px Inter, Arial, sans-serif" },
  club: { bg: "#14091f", fg: "#ffffff", border: "#ffffff", font: "italic 900 46px Inter, Arial, sans-serif" },
};

/**
 * All in-world text (street blades, shop fascia, For Rent boards) is drawn into
 * one canvas texture so signs batch into a single material and draw call.
 */
export class SignAtlas {
  readonly texture: DynamicTexture;
  readonly material: PBRMaterial;
  private next = 0;
  private free: number[] = [];
  /** Signs with no owner are pinned; owned signs give their slot back once every owner has released them. */
  private cache = new Map<string, { rect: UvRect; slot: number; owners: Set<string> | null }>();
  private owned = new Map<string, Set<string>>();
  private ctx: CanvasRenderingContext2D;
  private dirty = false;

  /**
   * `scale` shrinks the canvas, not the layout: a full-size atlas is 32 MB of canvas plus 43 MB of mipmapped texture,
   * more than an iPhone tab can spare on low graphics.
   */
  constructor(scene: Scene, private readonly scale = 1) {
    this.texture = new DynamicTexture("sign atlas", { width: WIDTH * scale, height: HEIGHT * scale }, scene, true);
    this.texture.hasAlpha = false;
    this.ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    this.ctx.fillStyle = "#808080";
    this.ctx.fillRect(0, 0, WIDTH * scale, HEIGHT * scale);
    // Every upload copies the whole canvas, so a district streaming in 80 signs uploads once, not 80 times.
    scene.onBeforeRenderObservable.add(() => {
      if (!this.dirty) return;
      this.dirty = false;
      this.texture.update(true);
    });
    this.material = new PBRMaterial("signs", scene);
    this.material.albedoTexture = this.texture;
    this.material.emissiveTexture = this.texture;
    this.material.emissiveColor = new Color3(0.28, 0.28, 0.28);
    this.material.roughness = 0.55;
    this.material.metallic = 0;
    this.material.environmentIntensity = 0.5;
  }

  /** Slots in use, out of the atlas's capacity. */
  usage() {
    return { used: this.cache.size, capacity: COLUMNS * ROWS };
  }

  /** Returns UVs for a text sign, drawing it on first use. Pass an owner (a world tile) to free the slot when it releases. */
  get(text: string, style: SignStyle, sub?: string, color?: string, owner?: string): UvRect {
    const key = `${style}|${text}|${sub ?? ""}|${color ?? ""}`;
    const cached = this.cache.get(key);
    if (cached) {
      if (!owner) cached.owners = null;
      else if (cached.owners) this.own(key, cached.owners, owner);
      return cached.rect;
    }
    const slot = this.free.pop() ?? (this.next < COLUMNS * ROWS ? this.next++ : -1);
    if (slot < 0) {
      console.warn(`Sign atlas full; "${text}" reuses another sign`);
      return this.cache.values().next().value!.rect;
    }
    const x = (slot % COLUMNS) * SLOT_W;
    const y = Math.floor(slot / COLUMNS) * SLOT_H;
    const palette = palettes[style];
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.fillStyle = color ?? palette.bg;
    ctx.fillRect(x, y, SLOT_W, SLOT_H);
    if (palette.border) {
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 5;
      ctx.strokeRect(x + 7, y + 7, SLOT_W - 14, SLOT_H - 14);
    }
    ctx.fillStyle = palette.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = Number(/(\d+)px/.exec(palette.font)?.[1] ?? 40);
    const fontFor = (px: number) => palette.font.replace(/\d+px/, `${px}px`);
    ctx.font = fontFor(size);
    while (ctx.measureText(text).width > SLOT_W - 40 && size > 16) {
      size -= 2;
      ctx.font = fontFor(size);
    }
    if (sub) {
      ctx.fillText(text, x + SLOT_W / 2, y + SLOT_H * 0.38);
      ctx.font = `600 ${Math.round(size * 0.55)}px Inter, Arial, sans-serif`;
      ctx.fillText(sub, x + SLOT_W / 2, y + SLOT_H * 0.76);
    } else {
      ctx.fillText(text, x + SLOT_W / 2, y + SLOT_H / 2 + 2);
    }
    ctx.restore();
    this.dirty = true;
    // Inset half a texel so neighbouring slots never bleed under mipmapping.
    const inset = 2 / this.scale;
    const rect = {
      u0: (x + inset) / WIDTH,
      u1: (x + SLOT_W - inset) / WIDTH,
      v0: 1 - (y + SLOT_H - inset) / HEIGHT,
      v1: 1 - (y + inset) / HEIGHT,
    };
    const owners = owner ? new Set<string>() : null;
    this.cache.set(key, { rect, slot, owners });
    if (owners) this.own(key, owners, owner!);
    return rect;
  }

  /** Gives back every sign only this owner was using, so later signs can be drawn into those slots. */
  release(owner: string) {
    const keys = this.owned.get(owner);
    if (!keys) return;
    this.owned.delete(owner);
    for (const key of keys) {
      const entry = this.cache.get(key);
      if (!entry?.owners) continue;
      entry.owners.delete(owner);
      if (entry.owners.size) continue;
      this.cache.delete(key);
      this.free.push(entry.slot);
    }
  }

  private own(key: string, owners: Set<string>, owner: string) {
    owners.add(owner);
    let keys = this.owned.get(owner);
    if (!keys) this.owned.set(owner, (keys = new Set()));
    keys.add(key);
  }

  static aspect = SLOT_W / SLOT_H;
}
