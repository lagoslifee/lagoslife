/**
 * Older iPads and iPhones (iOS 15 and earlier, which cannot update past it) lack these; one missing call while the
 * city is drawn throws and takes the whole game down. Each fallback only fills a gap, never replaces a native one.
 */
type Radii = number | DOMPointInit | Array<number | DOMPointInit>;

const canvasProtos: Array<object | undefined> = [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype];
for (const proto of canvasProtos) {
  if (!proto || "roundRect" in proto) continue;
  Object.defineProperty(proto, "roundRect", {
    configurable: true,
    writable: true,
    value(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: Radii = 0) {
      const first = Array.isArray(radii) ? radii[0] ?? 0 : radii;
      const raw = typeof first === "number" ? first : first.x ?? 0;
      const r = Math.max(0, Math.min(raw, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + r, y);
      this.lineTo(x + w - r, y);
      this.arcTo(x + w, y, x + w, y + r, r);
      this.lineTo(x + w, y + h - r);
      this.arcTo(x + w, y + h, x + w - r, y + h, r);
      this.lineTo(x + r, y + h);
      this.arcTo(x, y + h, x, y + h - r, r);
      this.lineTo(x, y + r);
      this.arcTo(x, y, x + r, y, r);
      this.closePath();
    },
  });
}

function at<T>(this: ArrayLike<T>, index: number): T | undefined {
  const n = Math.trunc(index) || 0;
  const i = n < 0 ? this.length + n : n;
  return i < 0 || i >= this.length ? undefined : this[i];
}
for (const proto of [Array.prototype, String.prototype, Object.getPrototypeOf(Int8Array.prototype)] as object[]) {
  if (!("at" in proto)) Object.defineProperty(proto, "at", { configurable: true, writable: true, value: at });
}

if (globalThis.crypto && !("randomUUID" in globalThis.crypto)) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value() {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

if (typeof AbortSignal !== "undefined" && !("timeout" in AbortSignal)) {
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value(ms: number) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("signal timed out", "TimeoutError")), ms);
      return controller.signal;
    },
  });
}
