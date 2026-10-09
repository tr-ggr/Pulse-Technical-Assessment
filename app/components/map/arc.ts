// The arc: a great-circle line on the globe between you and the stranger
// you're linked with, ember at your end and their hue at theirs. A comet of
// light travels along it — searching while you wait for an answer, flowing
// toward you when someone is calling, and a slow heartbeat once connected.

import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapboxMap,
} from "mapbox-gl";
import { greatCircle, type LatLng } from "@/lib/geo";
import { prefersReducedMotion } from "./nightfall";

const SOURCE = "pulse-arc";
const GLOW = "pulse-arc-glow";
const LINE = "pulse-arc-line";
const COMET = "pulse-arc-comet";

const EMBER = "hsl(29, 100%, 71%)";
const CLEAR = "rgba(255, 255, 255, 0)";
const HEAD = "rgba(255, 246, 232, 0.95)";

export type ArcMode = "seeking" | "calling" | "linked";

// Comet lap time per mode (ms); "linked" pauses between laps like a pulse.
const LAP_MS: Record<ArcMode, number> = {
  seeking: 1500,
  calling: 1300,
  linked: 2600,
};
const LINKED_REST_MS = 1800;
const FRAME_MS = 1000 / 30;

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function gradient(stops: [number, string][]): ExpressionSpecification {
  // line-gradient stops must strictly increase within [0, 1].
  const clean: [number, string][] = [];
  for (const [t, c] of stops) {
    const at = Math.min(1, Math.max(0, t));
    if (clean.length && at <= clean[clean.length - 1][0]) continue;
    clean.push([at, c]);
  }
  if (clean[clean.length - 1][0] < 1)
    clean.push([1, clean[clean.length - 1][1]]);
  return [
    "interpolate",
    ["linear"],
    ["line-progress"],
    ...clean.flat(),
  ] as ExpressionSpecification;
}

function cometGradient(p: number): ExpressionSpecification {
  return gradient([
    [0, CLEAR],
    [p - 0.24, CLEAR],
    [p - 0.03, "rgba(255, 230, 205, 0.45)"],
    [p, HEAD],
    [p + 0.012, CLEAR],
    [1, CLEAR],
  ]);
}

function addLayers(map: MapboxMap) {
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: "geojson", lineMetrics: true, data: EMPTY });
  }
  const layout = { "line-cap": "round", "line-join": "round" } as const;
  if (!map.getLayer(GLOW)) {
    map.addLayer({
      id: GLOW,
      type: "line",
      source: SOURCE,
      layout,
      paint: { "line-width": 9, "line-blur": 7, "line-opacity": 0.4 },
    });
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE,
      type: "line",
      source: SOURCE,
      layout,
      paint: { "line-width": 2, "line-opacity": 0.85 },
    });
  }
  if (!map.getLayer(COMET)) {
    map.addLayer({
      id: COMET,
      type: "line",
      source: SOURCE,
      layout,
      paint: { "line-width": 3.5, "line-gradient": cometGradient(-1) },
    });
  }
}

export interface ArcController {
  set(
    from: LatLng,
    to: LatLng,
    fromColor: string,
    toColor: string,
    mode: ArcMode,
  ): void;
  clear(): void;
  destroy(): void;
}

export function createArc(map: MapboxMap): ArcController {
  const reduced = prefersReducedMotion();
  let key = "";
  let mode: ArcMode | null = null;
  let raf = 0;
  let start = 0;
  let lastFrame = 0;

  const onStyle = () => addLayers(map);
  addLayers(map);
  map.on("style.load", onStyle);

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!mode || now - lastFrame < FRAME_MS) return;
    lastFrame = now;
    const lap = LAP_MS[mode];
    const cycle = mode === "linked" ? lap + LINKED_REST_MS : lap;
    const t = (now - start) % cycle;
    // Ease the head so it accelerates out and settles in, like a thrown spark.
    const x = Math.min(1, t / lap);
    const p = t > lap ? -1 : 1 - Math.pow(1 - x, 2.2);
    map.setPaintProperty(COMET, "line-gradient", cometGradient(p * 1.06));
  };

  function stopAnim() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (map.getLayer(COMET)) {
      map.setPaintProperty(COMET, "line-gradient", cometGradient(-1));
    }
  }

  return {
    set(from, to, fromColor, toColor, nextMode) {
      const nextKey = [from.lat, from.lng, to.lat, to.lng, fromColor, toColor]
        .map(String)
        .join("|");
      if (nextKey !== key) {
        key = nextKey;
        const source = map.getSource<GeoJSONSource>(SOURCE);
        source?.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: greatCircle(from, to, 96),
          },
        });
        const line = gradient([
          [0, fromColor],
          [1, toColor],
        ]);
        map.setPaintProperty(LINE, "line-gradient", line);
        map.setPaintProperty(GLOW, "line-gradient", line);
      }
      if (reduced || nextMode === mode) return;
      mode = nextMode;
      start = performance.now();
      if (!raf) raf = requestAnimationFrame(tick);
    },
    clear() {
      if (!key) return;
      key = "";
      mode = null;
      stopAnim();
      map.getSource<GeoJSONSource>(SOURCE)?.setData(EMPTY);
    },
    destroy() {
      mode = null;
      cancelAnimationFrame(raf);
      map.off("style.load", onStyle);
    },
  };
}

export { EMBER as ARC_EMBER };
