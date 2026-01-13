import { useState, useCallback, useRef } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp, Timestamp, orderBy } from 'firebase/firestore';
import { geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { db, initError } from '@/lib/firebase';

export interface EventDoc {
  id: string;
  lat: number;
  lng: number;
  ts: Timestamp;
  geohash: string;
}

export interface Hotspot {
  lat: number;
  lng: number;
  count: number;
}

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Grid cell size based on zoom level
function getGridSize(zoom: number): number {
  if (zoom >= 15) return 0.002;
  if (zoom >= 12) return 0.005;
  return 0.01;
}

// Aggregate events into grid-based hotspots
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

// Check if point is inside bounds (filter false positives from geohash)
function isInsideBounds(lat: number, lng: number, bounds: MapBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

export function useHotspots() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initError);
  const [timeFilter, setTimeFilter] = useState<'today' | 'hour'>('today');
  const seenIds = useRef<Set<string>>(new Set());

  const fetchEvents = useCallback(async (bounds: MapBounds, zoom: number) => {
    // Skip if Firebase not configured
    if (!db) {
      setError(initError || 'Firebase not initialized');
      return;
    }

    setIsLoading(true);
    
    try {
      const center: [number, number] = [
        (bounds.north + bounds.south) / 2,
        (bounds.east + bounds.west) / 2,
      ];
      
      // Calculate radius in meters (approximate)
      const latDiff = bounds.north - bounds.south;
      const lngDiff = bounds.east - bounds.west;
      const radiusKm = Math.max(latDiff, lngDiff) * 111 / 2;
      const radiusM = radiusKm * 1000;

      // Get time filter start
      const now = new Date();
      let startTime: Date;
      if (timeFilter === 'today') {
        startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      } else {
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
      }

      // Get geohash query bounds
      const queryBounds = geohashQueryBounds(center, radiusM);
      
      seenIds.current.clear();
      const allEvents: EventDoc[] = [];

      // Query each geohash range
      for (const b of queryBounds) {
        const q = query(
          collection(db, 'events'),
          orderBy('geohash'),
          where('geohash', '>=', b[0]),
          where('geohash', '<=', b[1])
        );

        const snapshot = await getDocs(q);
        
        for (const doc of snapshot.docs) {
          // De-duplicate across ranges
          if (seenIds.current.has(doc.id)) continue;
          seenIds.current.add(doc.id);

          const data = doc.data();
          const lat = data.lat as number;
          const lng = data.lng as number;
          const ts = data.ts as Timestamp;

          // Filter by time
          if (!ts || ts.toDate() < startTime) continue;

          // Filter false positives (outside actual bounds)
          if (!isInsideBounds(lat, lng, bounds)) continue;

          allEvents.push({
            id: doc.id,
            lat,
            lng,
            ts,
            geohash: data.geohash,
          });
        }
      }

      // Aggregate into hotspots
      const aggregated = aggregateToHotspots(allEvents, zoom);
      setHotspots(aggregated);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error fetching events:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [timeFilter]);

  const addTestEvent = useCallback(async (centerLat: number, centerLng: number) => {
    if (!db) {
      throw new Error('Firebase not initialized');
    }

    // Add small random jitter
    const jitterLat = (Math.random() - 0.5) * 0.01;
    const jitterLng = (Math.random() - 0.5) * 0.01;
    const lat = centerLat + jitterLat;
    const lng = centerLng + jitterLng;
    const geohash = geohashForLocation([lat, lng], 7);

    await addDoc(collection(db, 'events'), {
      lat,
      lng,
      geohash,
      ts: serverTimestamp(),
    });
  }, []);

  return {
    hotspots,
    lastUpdated,
    isLoading,
    error,
    timeFilter,
    setTimeFilter,
    fetchEvents,
    addTestEvent,
  };
}
