# Asset manifest

Last updated: 2026-10-11

| ID | Asset | Source / licence | State | Notes |
|---|---|---|---|---|
| resident-male-v2, resident-female-v2 | `characters/resident-male-v2.glb`, `characters/resident-female-v2.glb` | Built by `scripts/assets/build-residents.mjs` from Quaternius **Universal Base Characters** (Standard, free) and **Universal Animation Library** (Standard, free), both CC0 1.0 (https://quaternius.com/packs/universalbasecharacters.html, https://quaternius.com/packs/universalanimationlibrary.html, downloaded free from quaternius.itch.io on 2026-10-11; no attribution required, credited here anyway) | Final technique, temporary art | One 65-joint humanoid skeleton shared by both bodies (about 12.6k body triangles each). Hair from the kit (buzzed, side part, buns, long, beard) is fitted to both bodies through the Head bind pose. Garments are generated from each body's own surface: a shirt shell with smooth neck, hem and sleeve cuts, long-sleeve extension, trousers, lofted shoes and a flared skirt skinned to the pelvis and thighs; one draw call colours, prints (procedural ankara motif) and hides them per avatar. Clips copied by joint name: idle, walk, jog, sprint, sit, drive, dance, talk, interact, jump start/loop/land, fix, pick up. Stride speeds from `scripts/assets/measure-gait.mjs` foot span: walk 1.0, jog 3.9, sprint 6.8 m/s. Wave is procedural on top of idle. Textures: 1024² WebP colour, 512² WebP normal/roughness; about 1.5 MB per body. Replaces the Meshy `resident-v1` rig (its hands were displaced in several poses, and it had no female body); saved profiles without a body value load as male. |
| head-styles | Afro, twists, braids and locs hair; glasses, cap and gele headwrap | Generated at runtime by project code (`apps/web/src/game/avatar-style.ts`) | Temporary | Simple low-poly meshes built in "head units" measured from each body's head and eye vertices, attached to the Head bone. Functional rather than final art. |
| danfo-shell-v1 | `vehicles/danfo-shell-v1.glb` | Generated with Meshy (text-to-3D preview + refine); optimised with glTF Transform | Temporary (quality-review candidate) | Yellow minibus shell. The roof destination board, door gap, seated driver and conductor are added in code. Visual front orientation is set by `DANFO_MODEL_YAW` and was checked in screenshots at stops. |
| pbr-textures | `textures/*.webp` (asphalt, concrete, dirt, grass, pavers, plaster ×2, roof, tiles) | Poly Haven 1k maps, CC0 | Temporary | Converted to WebP (1024² colour/normal, 256² roughness) by `scripts/assets/compress-textures.mjs`. |
| daylight-hdr | `sky/daylight-1k.hdr` | Poly Haven 1k daylight HDRI, CC0 (the exact HDRI slug was not recorded at download time and must be recorded before it is treated as final) | Temporary | Used only for image-based lighting and reflections. The visible sky is a vertex-coloured gradient dome generated in code, because HDR prefiltering renders black on some software GPUs. |
| code-world | Buildings, compounds, roads, kerbs, drains, signs, shelters, palms, lights, tanks, interiors, ambient cars | Generated at runtime by project code (`apps/web/src/game/world-builder.ts`, `interior.ts`, `traffic.ts`) | Temporary | Procedural kit placed on OSM footprints and roads. Not presented as exact replicas of real buildings. |
| sign-atlas | Street blades, shop fascias, For Rent / For Sale boards, bus-stop flags, danfo destination boards | Rendered at runtime into one 2048² `DynamicTexture` | Final technique | Street names come only from OSM `name` tags; shop names are original fictional businesses. |
| lagos-osm | `world/lagos.world.json`, `world/tiles/*.json`, `packages/shared/src/generated/lagos-world.json` | © OpenStreetMap contributors, ODbL 1.0 (see `data/osm/` and `world/LICENSE.md`) | Geography dataset | Lekki Phase 1, the Link Bridge, Ikoyi and Victoria Island. Derived from the six `data/osm/*-extract.osm.json` Overpass extracts (2026-10-10) by `scripts/world/build-world.mjs`; see `docs/WORLD_DATA.md`. |
| ll-mark | Lagos Living interface mark and favicon | Original project vector | Final | |
| ui-fonts | System font stack | Browser/OS | Final | No external font requests. |

## Meshy usage

API access uses `MESHY_API_KEY` from the gitignored `apps/server/.env`; the key
is never sent to the browser or committed. `scripts/meshy/generate.mjs` records
every task in `docs/asset-generation-log.json` (signed URLs stripped).

| Task | Endpoint | Credits |
|---|---|---|
| resident-avatar preview | `/v2/text-to-3d` | 20 |
| danfo-shell preview | `/v2/text-to-3d` | 20 |
| resident-avatar refine | `/v2/text-to-3d` | 10 |
| danfo-shell refine | `/v2/text-to-3d` | 10 |
| resident-avatar rig | `/v1/rigging` | 5 |
| resident-avatar animations | `/v1/animations` | 30 |
| **Total** | | **95** |

Following the approval rule, only one avatar and one danfo were generated. The
Meshy avatar was retired on 2026-10-11 in favour of the free CC0 resident set
above; no further credits were spent. The
street section is procedural, so no Meshy credits were spent on it. **No bulk
generation has been run.** Further avatars, vehicles or props need explicit
approval of a budget and retry limit.

Future additions must record the source URL, author, licence, required
attribution, generation prompt and settings, modification history, triangle
count, texture sizes, animation list, and temporary or final status before
integration.
