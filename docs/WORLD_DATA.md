# World data and simplification

## Playable area

The playable world is a 1:1 metric reconstruction (x = east, z = north, metres,
projected around 6.444 N, 3.469 E) of four connected parts of Eti-Osa, Lagos.
Each is a district rectangle in `packages/shared/src/generated/lagos-world.json`;
residents and cars can only be inside one of them.

| District | Extent (x, z in metres) | Notes |
|---|---|---|
| Lekki Phase 1 | -1000…450, -230…540 | Around Admiralty Way, Adebayo Doherty Road, Kayode Animashaun Street and Chief Okoro Avenue. Starter home, jobs, shops, dealership and mechanic. |
| Lekki-Ikoyi Link Bridge | -2300…-1000, 220…800 | Both carriageways and both footways of the bridge over the lagoon. |
| Ikoyi | -4950…-1880, -440…1530 | Library and a church. |
| Victoria Island | -7050…-4110, -2410…-420 | Mosque, community hall and park. |

Altogether that is 1615 roads (26 of them bridges), 4950 building footprints and
915 landuse areas.

## Sources

`scripts/world/fetch-osm.mjs` downloads the Overpass extracts into `data/osm/`
(© OpenStreetMap contributors, ODbL 1.0), all fetched on 2026-10-10:

| File | Query |
|---|---|
| `lekki-phase1-extract.osm.json` | Roads, buildings, landuse and POIs in Lekki Phase 1 |
| `ikoyi-extract.osm.json` | The same for bbox 6.4400,3.4240–6.4580,3.4520 |
| `victoria-island-extract.osm.json` | The same for bbox 6.4220,3.4050–6.4400,3.4320 |
| `link-bridge-extract.osm.json` | Highways only, bbox 6.4440,3.4480–6.4520,3.4640 |
| `water-extract.osm.json` | Relations 2116203 (Lagos Lagoon), 2116206 (Five Cowries Creek), 17721809 (Commodore Channel) with geometry |
| `coastline-extract.osm.json` | `natural=coastline` ways around the area |

The script sends a User-Agent and retries across two public Overpass endpoints.
Fetching is a manual step; the build only reads the saved files.

## Build

`scripts/world/build-world.mjs` merges the extracts (deduplicating ways by id)
and writes:

- `apps/web/public/assets/world/lagos.world.json`: roads, districts, the tile
  list and the water render mask (428 KB). Loaded once at start.
- `apps/web/public/assets/world/tiles/{tx}_{tz}.json`: buildings and areas for
  each 320 m tile (173 tiles, 1.5 MB in total). These are streamed in as needed.
- `packages/shared/src/generated/lagos-world.json`: bounds, districts, tile
  size, the movement mask, the bridge decks, the danfo route and places (84 KB).
  The browser and the server use the same file.

Road kinds are normalised (trunk → primary, secondary → tertiary, links →
`primary_link`, `living_street` → residential, pedestrian → footway), and ways
tagged `bridge=yes` keep `bridge: true`.

## Water and bridges

Water polygons are assembled from the relation member rings and rasterised
(even-odd) onto a 10 m grid over the bounds plus a 640 m margin.

- **Rendering.** Land is drawn per tile as row strips, with marching squares
  on the 10 m samples at the shoreline. One lagoon plane lies beneath everything.
- **Movement.** The shared movement mask is the water grid with corridors
  cleared around ordinary roads (causeways and shoreline roads), sampled
  bilinearly. Bridges are not cleared on the grid. Each bridge way is instead a
  deck strip of half-width `width / 2 + 1 − 0.35` m, checked exactly, so the
  10 m grid can't leak past a parapet. `walkable()` = inside a district, not
  on open water (unless on a deck) and not inside a building. The server
  validates every position update with it and sends a correction otherwise.
- **Bridge look.** Parallel bridge ways (two carriageways, two footways) merge
  into one concrete deck. Parapets, the fascia and the obstacles residents and
  cars collide with run only along the outer edge of the merged deck, with
  piers every 32 m.

## Streaming

The client loads tiles within 420 m, 520 m or 640 m (low, medium or high
graphics) and unloads them past that radius plus 240 m. Tiles are built nearest
first, within a time budget per frame (8 ms once play has started, 200 ms while
loading). Each tile produces one mesh per material for its base geometry. Near
detail (façade kit, signs, awnings) is grouped in four 160 m chunks per tile,
and each chunk is only turned into meshes when the player comes within the
detail radius. The server registers every tile's building footprints at
startup. The client registers each tile's footprints as it arrives, so
collision and `walkable()` agree on both sides.

## Names and places

- **Street names.** Each name stays attached to its own OSM way. Ways without a
  `name` tag keep `name = null`. They are shown as "Unnamed road" (or "Unnamed
  service road") in the current-location display and are never labelled on
  signs or maps. No street names are invented.
- **Signs and maps.** Junction blades are generated only where two named roads
  meet; the subtitle is the district. Minimap and full-map labels are drawn
  upright along their own road segment. The full map is titled "Lagos" and has
  buttons that jump to each district.
- **Current location.** `StreetTracker` picks the nearest road with hysteresis;
  the subtitle is "District · Eti-Osa".
- **Businesses and venues.** OSM shop and amenity names (real brands) are never
  rendered. Shopfronts use original fictional names. Gameplay places are
  fictional and are seeded from `scripts/world/places.json` onto real
  footprints: Mama Titi's Buka, Swift Parcel Hub, Ikoyi Reading Room, Grace
  Assembly, Al-Noor Mosque, Island Community Hall, Muri Okunola Park and others.
  The park is the real OSM park area with a fictional sign. Religious venues
  are optional to visit and give exactly the same effect as the library and
  park.
- **Buildings.** OSM footprints are extruded with storey counts derived from
  building kind and footprint area (`building:levels` where present). The
  façade kit is procedural decoration, not a survey of the real buildings.
- **Transit.** Three district danfo loops, each built from the kerb lanes of a mapped
  dual carriageway (out on one carriageway, back on the other):
  L1 Admiralty Way Loop in Lekki Phase 1 (about 1.86 km, 5 stops),
  I1 Bourdillon Road Loop in Ikoyi (about 5.39 km, 5 stops, from Falomo
  Roundabout to Alexander Avenue by the Link Bridge landing) and
  V1 Adeola Odeku Loop in Victoria Island (about 3.44 km, 5 stops, from Akin
  Adesola Street to Ahmadu Bello Way). A fourth line, X1 Link Bridge Shuttle
  (about 4.75 km, 4 stops), follows the shortest legal main-road drive through
  the mapped OSM nodes, respecting one-way and roundabout direction. It runs
  from Admiralty Way west of Adebayo Doherty, round the Ikoyi Bridge
  Roundabout, over both Lekki - Ikoyi Bridge carriageways, round Alexander
  Roundabout, and down Alexander Avenue to Bourdillon Road. The bridge's
  642 m straight is subdivided every 50 m. Stop names are composed from the real
  road and cross-street names at each location; OSM maps no bus stops on these
  roads, so stop positions and the U-turns at each end are game placements.

The ODbL notice ships in `apps/web/public/assets/world/LICENSE.md`, and the game
view shows "Map data © OpenStreetMap contributors (ODbL)" at all times.
