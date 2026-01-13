import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, RefreshCw, Plus, AlertTriangle } from "lucide-react";
import { ref, get, push } from "firebase/database";
import { rtdb, initError } from "@/lib/firebase";

interface Hotspot {
  lat: number;
  lng: number;
  count: number;
}

type TimeFilter = "today" | "hour";

type RtdbEvent = {
  lat?: number;
  lng?: number;
  lon?: number;
  time?: string; // e.g. "2026-01-13 12:44:32"
  ts?: number; // optional millis
};

function normalizeLng(lng: number) {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}
function clampLat(lat: number) {
  return Math.max(-90, Math.min(90, lat));
}
function fixCoords(lat: number, lng: number) {
  return { lat: clampLat(lat), lng: normalizeLng(lng) };
}

function parseTimeToDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value !== "string") return null;

  // supports "YYYY-MM-DD HH:mm:ss" and ISO strings
  const s = value.includes("T") ? value : value.replace(" ", "T");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getHotspotColor(count: number): string {
  if (count >= 31) return "#ef4444";
  if (count >= 11) return "#f97316";
  if (count >= 4) return "#eab308";
  return "#22c55e";
}

function getHotspotRadius(count: number, zoom: number): number {
  return Math.max(8, zoom * 0.8) + Math.sqrt(count) * 4;
}

function getGridSize(zoom: number): number {
  if (zoom >= 15) return 0.002;
  if (zoom >= 12) return 0.005;
  return 0.01;
}

function aggregateToHotspots(
  points: Array<{ lat: number; lng: number }>,
  zoom: number
): Hotspot[] {
  const gridSize = getGridSize(zoom);
  const cells: Map<string, { totalLat: number; totalLng: number; count: number }> =
    new Map();

  for (const p of points) {
    const cellX = Math.floor(p.lng / gridSize);
    const cellY = Math.floor(p.lat / gridSize);
    const key = `${cellX},${cellY}`;

    const cell = cells.get(key);
    if (cell) {
      cell.totalLat += p.lat;
      cell.totalLng += p.lng;
      cell.count += 1;
    } else {
      cells.set(key, { totalLat: p.lat, totalLng: p.lng, count: 1 });
    }
  }

  return Array.from(cells.values()).map((c) => ({
    lat: c.totalLat / c.count,
    lng: c.totalLng / c.count,
    count: c.count,
  }));
}

// ✅ demo fixed point (change if you want)
const DEMO_POINT = { lat: 21.492562427776477, lng: 39.242159744145006 };


export default function HotspotMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const hotspotsLayerRef = useRef<L.LayerGroup | null>(null);

  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("today");
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(initError);

  const fetchEvents = useCallback(async () => {
    if (!mapRef.current) return;

    if (!rtdb) {
      setError(initError || "Firebase RTDB not initialized");
      return;
    }

    setIsLoading(true);

    try {
      const zoom = mapRef.current.getZoom();

      const now = new Date();
      const startTime =
        timeFilter === "today"
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
          : new Date(now.getTime() - 60 * 60 * 1000);

      // Read all events from RTDB: /events
      const snap = await get(ref(rtdb, "events"));
      const val = snap.val() as Record<string, RtdbEvent> | null;

      const points: Array<{ lat: number; lng: number }> = [];

      if (val) {
        for (const [, data] of Object.entries(val)) {
          // time filter (supports time string OR ts millis)
          const eventDate =
            parseTimeToDate(data.ts) || parseTimeToDate(data.time);

          if (!eventDate || eventDate < startTime) continue;

          // If you want to USE incoming coords, use these:
          const rawLat = Number(data.lat);
          const rawLng = Number((data as any).lng ?? (data as any).lon);

          // If coords are missing/invalid, skip
          const hasCoords = Number.isFinite(rawLat) && Number.isFinite(rawLng);

          // ✅ You said for demo you can hardwire the spot:
          const used = fixCoords(
            DEMO_POINT.lat,
            DEMO_POINT.lng
          );

          // If you want real coords later, swap to:
          // const used = hasCoords ? fixCoords(rawLat, rawLng) : fixCoords(DEMO_POINT.lat, DEMO_POINT.lng);

          // Add point
          points.push({ lat: used.lat, lng: used.lng });

          // (Optional) If you prefer: skip records that have no coords at all
          // if (!hasCoords) continue;
        }
      }

      const aggregated = aggregateToHotspots(points, zoom);
      setHotspots(aggregated);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Error fetching RTDB events:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [timeFilter]);

  const addTestEvent = useCallback(async () => {
    if (!rtdb || isAdding) return;

    setIsAdding(true);
    try {
      const fixed = fixCoords(DEMO_POINT.lat, DEMO_POINT.lng);

      // Push to /events (RTDB)
      await push(ref(rtdb, "events"), {
        lat: fixed.lat,
        lon: fixed.lng, // matches your ESP field name
        time: new Date().toISOString().slice(0, 19).replace("T", " "),
        ts: Date.now(),
        source: "web-test",
      });

      setTimeout(fetchEvents, 300);
    } catch (err) {
      console.error("Failed to add RTDB test event:", err);
      setError(err instanceof Error ? err.message : "Failed to add test event");
    } finally {
      setIsAdding(false);
    }
  }, [fetchEvents, isAdding]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Restore last view (nice UX)
    const saved = localStorage.getItem("mapView");
    const defaultView = saved
      ? (JSON.parse(saved) as { center: [number, number]; zoom: number })
      : { center: [DEMO_POINT.lat, DEMO_POINT.lng] as [number, number], zoom: 12 };

    const map = L.map(mapContainerRef.current, {
      center: defaultView.center,
      zoom: defaultView.zoom,
      zoomControl: true,
      worldCopyJump: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    hotspotsLayerRef.current = L.layerGroup().addTo(map);

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleMapMove = () => {
      // save view
      const c = map.getCenter();
      localStorage.setItem(
        "mapView",
        JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() })
      );

      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => fetchEvents(), 250);
    };

    map.on("moveend", handleMapMove);
    map.on("zoomend", handleMapMove);

    mapRef.current = map;

    setTimeout(fetchEvents, 100);

    return () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      map.remove();
      mapRef.current = null;
    };
  }, [fetchEvents]);

  // Update hotspots layer
  useEffect(() => {
    if (!hotspotsLayerRef.current || !mapRef.current) return;

    hotspotsLayerRef.current.clearLayers();
    const zoom = mapRef.current.getZoom();

    hotspots.forEach((h) => {
      const circle = L.circleMarker([h.lat, h.lng], {
        radius: getHotspotRadius(h.count, zoom),
        fillColor: getHotspotColor(h.count),
        fillOpacity: 0.7,
        color: getHotspotColor(h.count),
        weight: 2,
      });

      circle.bindPopup(`<strong>Count: ${h.count}</strong>`);
      circle.addTo(hotspotsLayerRef.current!);
    });
  }, [hotspots]);

  // Polling every 8 seconds
  useEffect(() => {
    const interval = setInterval(fetchEvents, 8000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Refresh when time filter changes
  useEffect(() => {
    fetchEvents();
  }, [timeFilter, fetchEvents]);

  const formatTime = (date: Date | null) => {
    if (!date) return "--:--:--";
    return date.toLocaleTimeString();
  };

  return (
    <div className="relative w-full h-screen bg-muted">
      <div ref={mapContainerRef} className="w-full h-full" />

      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-3 max-w-xs">
        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-5 h-5 text-primary" />
            <h1 className="font-bold text-lg text-foreground">Live Hotspots</h1>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-destructive">Error</p>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <Button
              variant={timeFilter === "today" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeFilter("today")}
              className="flex-1"
            >
              Today
            </Button>
            <Button
              variant={timeFilter === "hour" ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeFilter("hour")}
              className="flex-1"
            >
              Last Hour
            </Button>
          </div>

          <Button
            disabled={!!error || isAdding}
            onClick={addTestEvent}
            className="w-full"
            variant="secondary"
          >
            <Plus className="w-4 h-4 mr-2" />
            {isAdding ? "Adding..." : "Add Test Event"}
          </Button>
        </div>

        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>Updated: {formatTime(lastUpdated)}</span>
            {isLoading && <RefreshCw className="w-3 h-3 animate-spin ml-auto" />}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {hotspots.length} hotspot{hotspots.length !== 1 ? "s" : ""} visible
          </div>
        </div>

        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-lg">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Legend
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-foreground">1-3 events</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-foreground">4-10 events</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-foreground">11-30 events</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-foreground">31+ events</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
