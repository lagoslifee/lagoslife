# World data and simplification

## Lekki Phase 1 (current playable section)

The playable world is a 1:1 metric reconstruction (x = east, z = north, metres)
of a connected part of Lekki Phase 1 around Admiralty Way, Adebayo Doherty
Road, Kayode Animashaun Street, Victoria Arobieke Street and Chief Okoro
Avenue. It covers about 1.1 × 0.8 km.

- **Source.** `data/osm/lekki-phase1-extract.osm.json` is an Overpass API
  extract fetched on 2026-10-10 (© OpenStreetMap contributors, ODbL 1.0).
- **Build.** `scripts/world/build-lekki.mjs` projects latitude and longitude
  around 6.444 N, 3.469 E into local metres. It keeps roads (kind, width, OSM
  `name`), building footprints, landuse areas and the transit route, and writes
  `apps/web/public/assets/world/lekki-phase1.world.json`.
- **Street names.** Each name stays attached to its own OSM way. Ways without a
  `name` tag keep `name = null`. They are shown as "Unnamed road" (or "Unnamed
  service road") in the current-location display and are never labelled on
  signs or maps. No street names are invented.
- **Signs and maps.** Junction blades are generated only where two named roads
  meet. Minimap and full-map labels are drawn upright along their own road
  segment, with collision rejection and zoom-dependent density.
- **Current location.** `StreetTracker` picks the nearest road with hysteresis
  so the display does not flicker at junctions.
- **Businesses.** OSM shop and amenity names (real brands) are never rendered.
  Shopfronts use original fictional names, and gameplay places (Mama Titi's
  Buka, Swift Parcel Hub, Adebayo Court, Okoro Terrace and others) are fictional.
- **Buildings.** OSM footprints are extruded with storey counts derived from
  building kind and footprint area (`building:levels` where present). The
  façade kit (windows, burglar bars, balconies, AC units, shopfronts,
  compound walls, gates and security posts) is procedural decoration, not a
  survey of the real buildings.
- **Transit.** The danfo loop (route L1, about 1.86 km, 5 stops) follows mapped
  roads. Stop names are composed from the real road names at each location.

The ODbL notice and the derivative database ship in
`apps/web/public/assets/world/`. The game view shows "Map data © OpenStreetMap
contributors (ODbL)" at all times.

## Ikoyi extract (retained)

`ikoyi-starter.osm.json` (bbox 6.4445,3.4240–6.4545,3.4360) is retained for the
Ikoyi expansion and is not loaded by the current build.
