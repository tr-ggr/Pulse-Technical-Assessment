"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { formatDistance, peerColor } from "@/lib/identity";
import { haversineKm } from "@/lib/geo";
import { applyNightfall, startSpin } from "./map/nightfall";
import {
  ARC_EMBER,
  createArc,
  type ArcController,
  type ArcMode,
} from "./map/arc";
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

const liveZoom = () => (window.innerWidth < 768 ? LIVE_ZOOM - 0.4 : LIVE_ZOOM);

export interface WorldMapHandle {
  recenter: () => void;
}

const ARC_MODE: Record<LinkPhase, ArcMode> = {
  requesting: "seeking",
  incoming: "calling",
  connecting: "seeking",
  connected: "linked",
};

// Room the UI takes up around the map, so framed things land in clear space.
function framePadding() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 1024) {
    return {
      top: 110,
      right: 48,
      bottom: Math.round(Math.min(h * 0.68, 640)) + 40,
      left: 48,
    };
  }
  // The chat card (400px + margins) docks right once the stranger accepts.
  return { top: 120, right: 480, bottom: 120, left: 120 };
}

function dotStateFor(peerId: string, link: MapLink | null): DotState {
  if (!link || link.peerId !== peerId) return "idle";
  if (link.phase === "requesting") return "target";
  if (link.phase === "incoming") return "caller";
  return "partner";
}

export default function WorldMap({
  ref,
  mode,
  peers,
  me,
  link,
  onPeerClick,
  canConnect,
}: {
  ref?: Ref<WorldMapHandle>;
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
  const arcRef = useRef<ArcController | null>(null);

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  useImperativeHandle(
    ref,
    () => ({
      recenter() {
        if (!me) return;
        mapRef.current?.flyTo({
          center: [me.lng, me.lat],
          zoom: Math.max(liveZoom(), mapRef.current.getZoom()),
          duration: 1600,
        });
      },
    }),
    [me],
  );

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
        if (cancelled) return;
        arcRef.current = createArc(map);
        setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      arcRef.current?.destroy();
      arcRef.current = null;
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
        zoom: liveZoom(),
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

  // Draw the arc to whoever you're linked with, and keep it in sync as their
  // dot updates. Their colour is the arc's far end; ember is yours.
  const linkPeerId = link?.peerId ?? null;
  const linkPhase = link?.phase ?? null;
  const linkPeer = linkPeerId
    ? peers.find((p) => p.id === linkPeerId)
    : undefined;
  const linkLat = linkPeer?.lat;
  const linkLng = linkPeer?.lng;
  useEffect(() => {
    const arc = arcRef.current;
    if (!arc || !ready) return;
    if (
      !linkPeerId ||
      !linkPhase ||
      !me ||
      linkLat === undefined ||
      linkLng === undefined
    ) {
      arc.clear();
      return;
    }
    const peer = { lat: linkLat, lng: linkLng };
    const theirs = peerColor(linkPeerId);
    // A call comes *to* you: draw it from them, so the comet flies home.
    if (linkPhase === "incoming") {
      arc.set(peer, me, theirs, ARC_EMBER, ARC_MODE[linkPhase]);
    } else {
      arc.set(me, peer, ARC_EMBER, theirs, ARC_MODE[linkPhase]);
    }
  }, [ready, me, linkPeerId, linkPhase, linkLat, linkLng]);

  // Frame you and the stranger together, once, when a link starts.
  const framedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me || !linkPeerId) {
      if (!linkPeerId) framedRef.current = null;
      return;
    }
    if (
      framedRef.current === linkPeerId ||
      linkLat === undefined ||
      linkLng === undefined
    )
      return;
    framedRef.current = linkPeerId;
    // Unwrap across the antimeridian so the box spans the short way round.
    let lng = linkLng;
    while (lng - me.lng > 180) lng -= 360;
    while (lng - me.lng < -180) lng += 360;
    map.fitBounds(
      [
        [Math.min(me.lng, lng), Math.min(me.lat, linkLat)],
        [Math.max(me.lng, lng), Math.max(me.lat, linkLat)],
      ],
      { padding: framePadding(), maxZoom: 5.5, duration: 1800 },
    );
  }, [ready, me, linkPeerId, linkLat, linkLng]);

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
            // Tapping back someone who asked you is a yes, card or not.
            const caller = el.dataset.state === "caller";
            const free = el.dataset.busy !== "true";
            if (caller || (canConnectRef.current && free)) {
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
          <p className="glass max-w-md rounded-card p-5 text-sm leading-relaxed text-ink-muted">
            Set{" "}
            <code className="font-mono text-ember">
              NEXT_PUBLIC_MAPBOX_TOKEN
            </code>{" "}
            in <code className="font-mono text-ink">.env</code> to load the
            globe.
          </p>
        </div>
      )}
    </div>
  );
}
