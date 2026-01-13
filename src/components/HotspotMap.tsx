import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { MapPin, Clock, RefreshCw, Plus, AlertTriangle } from 'lucide-react';
import { collection, query, where, getDocs, addDoc, serverTimestamp, Timestamp, orderBy } from 'firebase/firestore';
import { geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { db, initError } from '@/lib/firebase';

interface Hotspot {
  lat: number;
  lng: number;
  count: number;
}

interface EventDoc {
  id: string;
  lat: number;
  lng: number;
  ts: Timestamp;
  geohash: string;
}

function getHotspotColor(count: number): string {
  if (count >= 31) return '#ef4444';
  if (count >= 11) return '#f97316';
  if (count >= 4) return '#eab308';
  return '#22c55e';
}

function getHotspotRadius(count: number, zoom: number): number {
  return Math.max(8, zoom * 0.8) + Math.sqrt(count) * 4;
}

function getGridSize(zoom: number): number {
  if (zoom >= 15) return 0.002;
  if (zoom >= 12) return 0.005;
  return 0.01;
}

function aggregateToHotspots(events: EventDoc[], zoom: number): Hotspot[] {
  const gridSize = getGridSize(zoom);
  const cells: Map<string, { totalLat: number; totalLng: number; count: number }> = new Map();

  for (const event of events) {
    const cellX = Math.floor(event.lng / gridSize);
    const cellY = Math.floor(event.lat / gridSize);
    const key = `${cellX},${cellY}`;

    const cell = cells.get(key);
    if (cell) {
      cell.totalLat += event.lat;
      cell.totalLng += event.lng;
      cell.count += 1;
    } else {
      cells.set(key, { totalLat: event.lat, totalLng: event.lng, count: 1 });
    }
  }

  return Array.from(cells.values()).map(cell => ({
    lat: cell.totalLat / cell.count,
    lng: cell.totalLng / cell.count,
    count: cell.count,
  }));
}

export default function HotspotMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const hotspotsLayerRef = useRef<L.LayerGroup | null>(null);
  
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeFilter, setTimeFilter] = useState<'today' | 'hour'>('today');
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(initError);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const fetchEvents = useCallback(async () => {
    if (!mapRef.current || !db) {
      setError(initError || 'Firebase not initialized');
      return;
    }

    setIsLoading(true);

    try {
      const bounds = mapRef.current.getBounds();
      const zoom = mapRef.current.getZoom();
      const center: [number, number] = [
        (bounds.getNorth() + bounds.getSouth()) / 2,
        (bounds.getEast() + bounds.getWest()) / 2,
      ];

      const latDiff = bounds.getNorth() - bounds.getSouth();
      const lngDiff = bounds.getEast() - bounds.getWest();
      const radiusKm = Math.max(latDiff, lngDiff) * 111 / 2;
      const radiusM = radiusKm * 1000;

      const now = new Date();
      const startTime = timeFilter === 'today'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
        : new Date(now.getTime() - 60 * 60 * 1000);

      const queryBounds = geohashQueryBounds(center, radiusM);
      seenIdsRef.current.clear();
      const allEvents: EventDoc[] = [];

      for (const b of queryBounds) {
        const q = query(
          collection(db, 'events'),
          orderBy('geohash'),
          where('geohash', '>=', b[0]),
          where('geohash', '<=', b[1])
        );

        const snapshot = await getDocs(q);

        for (const doc of snapshot.docs) {
          if (seenIdsRef.current.has(doc.id)) continue;
          seenIdsRef.current.add(doc.id);

          const data = doc.data();
          const lat = data.lat as number;
          const lng = data.lng as number;
          const ts = data.ts as Timestamp;

          if (!ts || ts.toDate() < startTime) continue;
          if (lat < bounds.getSouth() || lat > bounds.getNorth() ||
              lng < bounds.getWest() || lng > bounds.getEast()) continue;

          allEvents.push({ id: doc.id, lat, lng, ts, geohash: data.geohash });
        }
      }

      const aggregated = aggregateToHotspots(allEvents, zoom);
      setHotspots(aggregated);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error fetching events:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [timeFilter]);

  const addTestEvent = useCallback(async () => {
    if (!mapRef.current || !db || isAdding) return;

    setIsAdding(true);
    try {
      const center = mapRef.current.getCenter();
      const jitterLat = (Math.random() - 0.5) * 0.01;
      const jitterLng = (Math.random() - 0.5) * 0.01;
      const lat = center.lat + jitterLat;
      const lng = center.lng + jitterLng;
      const geohash = geohashForLocation([lat, lng], 7);

      await addDoc(collection(db, 'events'), {
        lat,
        lng,
        geohash,
        ts: serverTimestamp(),
      });

      setTimeout(fetchEvents, 500);
    } catch (err) {
      console.error('Failed to add test event:', err);
    } finally {
      setIsAdding(false);
    }
  }, [fetchEvents, isAdding]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [40.7128, -74.006],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    hotspotsLayerRef.current = L.layerGroup().addTo(map);

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleMapMove = () => {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        if (mapRef.current) fetchEvents();
      }, 250);
    };

    map.on('moveend', handleMapMove);
    map.on('zoomend', handleMapMove);

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
    if (!date) return '--:--:--';
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
                  <p className="font-medium text-destructive">Firebase not configured</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Edit src/lib/firebase.ts with your config.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <Button
              variant={timeFilter === 'today' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeFilter('today')}
              className="flex-1"
            >
              Today
            </Button>
            <Button
              variant={timeFilter === 'hour' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeFilter('hour')}
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
            {isAdding ? 'Adding...' : 'Add Test Event'}
          </Button>
        </div>

        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>Updated: {formatTime(lastUpdated)}</span>
            {isLoading && <RefreshCw className="w-3 h-3 animate-spin ml-auto" />}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {hotspots.length} hotspot{hotspots.length !== 1 ? 's' : ''} visible
          </div>
        </div>

        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-lg">
          <div className="text-xs font-medium text-muted-foreground mb-2">Legend</div>
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
