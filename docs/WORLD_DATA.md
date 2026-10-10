# World data and simplification

## Ikoyi starter section

The current playable section uses OpenStreetMap roads and building footprints
from bbox `6.4445,3.4240–6.4545,3.4360`, covering a gameplay-scaled area around
Bourdillon Road and Glover Road.

Projection converts latitude/longitude to local metres around
`6.4495,3.4300`, then scales distances to 12% for a compact development area.
Road centre lines are rendered as connected collision boxes. Building
footprints are currently represented by their axis-aligned bounding forms, with
height taken from `building:levels` where available and deterministic fictional
height otherwise.

These simplifications preserve the broad road/building layout but are not exact
architectural replicas. Decorative palms, materials, stairs, and ramps are
fictional gameplay additions.

The source extract and ODbL notice are distributed in
`apps/web/public/assets/world/`. Visible attribution links to the full
OpenStreetMap copyright page from the game view.
