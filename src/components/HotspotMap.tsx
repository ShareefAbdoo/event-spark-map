import { useEffect, useRef, useCallback, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import { Button } from '@/components/ui/button';
import { MapPin, Clock, RefreshCw, Plus, AlertTriangle } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface Hotspot {
  lat: number;
  lng: number;
  count: number;
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

function HotspotLayer({ hotspots }: { hotspots: Hotspot[] }) {
  const map = useMap();
  const zoom = map.getZoom();

  return (
    <>
      {hotspots.map((h, i) => (
        <CircleMarker
          key={`${h.lat}-${h.lng}-${i}`}
          center={[h.lat, h.lng]}
          radius={getHotspotRadius(h.count, zoom)}
          pathOptions={{ fillColor: getHotspotColor(h.count), fillOpacity: 0.7, color: getHotspotColor(h.count), weight: 2 }}
        >
          <Tooltip><span className="font-semibold">Count: {h.count}</span></Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

function MapEventsHandler({ onBoundsChange }: { onBoundsChange: () => void }) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMapEvents({
    moveend: () => { if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(onBoundsChange, 250); },
    zoomend: () => { if (debounceRef.current) clearTimeout(debounceRef.current); debounceRef.current = setTimeout(onBoundsChange, 250); },
  });
  return null;
}

function MapRefProvider({ onMapReady }: { onMapReady: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => { onMapReady(map); }, [map, onMapReady]);
  return null;
}

export default function HotspotMap() {
  const [hotspots] = useState<Hotspot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeFilter, setTimeFilter] = useState<'today' | 'hour'>('today');
  const mapRef = useRef<LeafletMap | null>(null);
  const firebaseNotConfigured = true; // Placeholder until Firebase is configured

  const refreshData = useCallback(() => {
    setLastUpdated(new Date());
  }, []);

  const handleMapReady = useCallback((map: LeafletMap) => {
    mapRef.current = map;
    setTimeout(refreshData, 100);
  }, [refreshData]);

  useEffect(() => {
    const interval = setInterval(refreshData, 8000);
    return () => clearInterval(interval);
  }, [refreshData]);

  return (
    <div className="relative w-full h-screen bg-muted">
      <MapContainer center={[40.7128, -74.006]} zoom={12} style={{ width: '100%', height: '100%' }} zoomControl={true}>
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <HotspotLayer hotspots={hotspots} />
        <MapEventsHandler onBoundsChange={refreshData} />
        <MapRefProvider onMapReady={handleMapReady} />
      </MapContainer>

      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-3 max-w-xs">
        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-5 h-5 text-primary" />
            <h1 className="font-bold text-lg text-foreground">Live Hotspots</h1>
          </div>
          {firebaseNotConfigured && (
            <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Firebase not configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Edit src/lib/firebase.ts with your config.</p>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2 mb-3">
            <Button variant={timeFilter === 'today' ? 'default' : 'outline'} size="sm" onClick={() => setTimeFilter('today')} className="flex-1">Today</Button>
            <Button variant={timeFilter === 'hour' ? 'default' : 'outline'} size="sm" onClick={() => setTimeFilter('hour')} className="flex-1">Last Hour</Button>
          </div>
          <Button disabled={firebaseNotConfigured} className="w-full" variant="secondary"><Plus className="w-4 h-4 mr-2" />Add Test Event</Button>
        </div>
        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="w-4 h-4" /><span>Updated: {lastUpdated?.toLocaleTimeString() || '--:--:--'}</span></div>
          <div className="text-xs text-muted-foreground mt-1">{hotspots.length} hotspots visible</div>
        </div>
        <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl px-4 py-3 shadow-lg">
          <div className="text-xs font-medium text-muted-foreground mb-2">Legend</div>
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500" /><span>1-3 events</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-yellow-500" /><span>4-10 events</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500" /><span>11-30 events</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500" /><span>31+ events</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
