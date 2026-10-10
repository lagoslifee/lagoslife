import { readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(manifest.dependencies).filter((name) => !name.startsWith("@lagos-living/"));

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: ["src/index.ts", "src/migrate.ts", "src/staff.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  logLevel: "info",
});
