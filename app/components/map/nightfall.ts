// "Nightfall": restyles Mapbox's dark-v11 into an ink-blue globe floating in
// starry space. Runs on every `style.load` (fog and paint overrides are part of
// the style, so a style reload would otherwise drop them).

import type { Map as MapboxMap } from "mapbox-gl";

const OCEAN = "hsl(230, 45%, 6%)";
const LAND = "hsl(229, 32%, 13%)";
const ROAD = "hsl(230, 24%, 21%)";
const BORDER = "hsla(232, 45%, 72%, 0.22)";
const LABEL_HALO = "hsl(230, 45%, 6%)";

// Street-level clutter that never helps you find a stranger.
const HIDDEN_SYMBOLS =
  /road|poi|airport|transit|natural|waterway|water-|subdivision/;

function paint(map: MapboxMap, id: string, prop: string, value: unknown) {
  if (map.getLayer(id)) {
    // Paint property names are a string union in the typings; ids come from
    // the style, so a loose call is the honest type here.
    (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
      id,
      prop,
      value,
    );
  }
}

export function applyNightfall(map: MapboxMap): void {
  map.setFog({
    range: [0.8, 8],
    color: "rgb(18, 24, 54)", // atmosphere at the horizon
    "high-color": "rgb(52, 70, 168)", // the blue rim around the globe
    "horizon-blend": 0.06,
    "space-color": "rgb(4, 5, 11)",
    "star-intensity": 0.6,
  });

  paint(map, "land", "background-color", LAND);
  for (const id of ["landuse", "national-park", "land-structure-polygon"]) {
    paint(map, id, "fill-color", LAND);
  }
  paint(map, "land-structure-line", "line-color", LAND);
  paint(map, "water", "fill-color", OCEAN);
  paint(map, "waterway", "line-color", OCEAN);
  paint(map, "building", "fill-color", "hsl(230, 28%, 17%)");

  for (const id of ["admin-0-boundary", "admin-0-boundary-disputed"]) {
    paint(map, id, "line-color", BORDER);
  }
  paint(map, "admin-1-boundary", "line-color", "hsla(232, 45%, 72%, 0.1)");
  for (const id of ["admin-0-boundary-bg", "admin-1-boundary-bg"]) {
    paint(map, id, "line-color", LAND);
  }

  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "line" && /^(road|bridge|tunnel)-/.test(layer.id)) {
      paint(map, layer.id, "line-color", ROAD);
    }
    if (layer.type !== "symbol") continue;
    if (HIDDEN_SYMBOLS.test(layer.id)) {
      map.setLayoutProperty(layer.id, "visibility", "none");
    } else {
      paint(map, layer.id, "text-halo-color", LABEL_HALO);
    }
  }

  // Quiet, cool labels: places read as context, never compete with the dots.
  paint(map, "country-label", "text-color", "hsla(228, 30%, 78%, 0.55)");
  paint(map, "continent-label", "text-color", "hsla(228, 30%, 78%, 0.35)");
  paint(map, "state-label", "text-color", "hsla(228, 25%, 74%, 0.26)");
  paint(map, "settlement-major-label", "text-color", "hsla(228, 30%, 86%, 0.72)");
  paint(map, "settlement-minor-label", "text-color", "hsla(228, 25%, 80%, 0.42)");
}
