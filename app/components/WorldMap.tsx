"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { formatDistance } from "@/lib/identity";
import { haversineKm } from "@/lib/geo";
import { applyNightfall, startSpin } from "./map/nightfall";
import {
  createMeEl,
  createPeerEl,
  updatePeerEl,
  type DotState,
} from "./map/markers";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export type LinkPhase = "requesting" | "incoming" | "connecting" | "connected";

// The stranger you're currently linked with (asking, being asked, or talking).
export interface MapLink {
  peerId: string;
  phase: LinkPhase;
}

// Mapbox enlarges the globe at low zooms, so the on-screen size can't be
// derived from the zoom alone: measure the projected radius (centre → a point
// 90° away on the limb) and correct the zoom until it fits `diameter`.
function fitGlobe(map: MapboxMap, diameter: number) {
  for (let i = 0; i < 3; i++) {
    const c = map.getCenter();
    const centre = map.project([c.lng, c.lat]);
    const limb = map.project([c.lng + 90, 0]);
    const radius = Math.hypot(limb.x - centre.x, limb.y - centre.y);
    if (!Number.isFinite(radius) || radius < 1) return;
    map.jumpTo({ zoom: map.getZoom() + Math.log2(diameter / (2 * radius)) });
  }
}

// Entry-screen framing: the globe sits beside the gate copy on wide screens
// and above it on phones, sized to the space that's left.
function introView() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 768) {
    const bottom = Math.round(h * 0.46);
    return {
      diameter: Math.min(w * 0.9, (h - bottom) * 0.9),
      padding: { top: 0, right: 0, bottom, left: 0 },
    };
  }
  const left = Math.round(Math.min(560, w * 0.42));
  return {
    diameter: Math.min((w - left) * 0.84, h * 0.82),
    padding: { top: 0, right: 0, bottom: 0, left },
  };
}

// Open on the visitor's side of the world, guessed from their timezone, so
// the first thing they see is home — before granting any permission.
function homeLongitude(): number {
  return (-new Date().getTimezoneOffset() / 60) * 15;
}

export const LIVE_ZOOM = 3.4;

function dotStateFor(peerId: string, link: MapLink | null): DotState {
  if (!link || link.peerId !== peerId) return "idle";
  if (link.phase === "requesting") return "target";
  if (link.phase === "incoming") return "caller";
  return "partner";
}

export default function WorldMap({
  mode,
  peers,
  me,
  link,
  onPeerClick,
  canConnect,
}: {
  // "intro": idle spinning globe behind the entry gate. "live": you're on it.
  mode: "intro" | "live";
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  link: MapLink | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // Initialise the map once.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const intro = introView();
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        center: [homeLongitude(), 18],
        zoom: 1.5,
        attributionControl: false,
      });
      map.setPadding(intro.padding);
      fitGlobe(map, intro.diameter);
      map.addControl(new mapboxgl.AttributionControl({ compact: true }));
      map.on("style.load", () => applyNightfall(map));
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Idle spin behind the gate; once live, fly down to your beacon (once).
  const flewRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (mode === "intro") return startSpin(map);
    if (me && !flewRef.current) {
      flewRef.current = true;
      // Not `essential`: Mapbox turns this into a jump under reduced motion.
      map.flyTo({
        center: [me.lng, me.lat],
        zoom: window.innerWidth < 768 ? LIVE_ZOOM - 0.4 : LIVE_ZOOM,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        duration: 2800,
        curve: 1.6,
      });
    }
  }, [mode, me, ready]);

  // Show / move your own beacon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        meMarkerRef.current = new mapboxgl.Marker({
          element: createMeEl(),
          anchor: "center",
        })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = createPeerEl(peer.id);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canConnectRef.current && el.dataset.busy !== "true") {
              onPeerClickRef.current(peer.id);
            }
          });
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        }
        updatePeerEl(marker.getElement(), {
          busy: peer.busy,
          state: dotStateFor(peer.id, link),
          canConnect,
          distanceLabel: me ? formatDistance(haversineKm(me, peer)) : null,
        });
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready, link, canConnect, me]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className={`h-full w-full bg-space transition-opacity duration-1000 ${
          ready || !TOKEN ? "opacity-100" : "opacity-0"
        }`}
      />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md rounded-lg bg-zinc-800 p-4 text-sm text-zinc-200">
            Set{" "}
            <code className="text-emerald-400">NEXT_PUBLIC_MAPBOX_TOKEN</code>{" "}
            in <code>.env</code> to load the map.
          </p>
        </div>
      )}

      {/* Online count */}
      <div className="absolute bottom-4 left-4 rounded-full bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur">
        {peers.length} online
      </div>
    </div>
  );
}
