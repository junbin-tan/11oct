import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPlayer } from './GameMap';
import { UiIcon } from './UiIcon';
import { RADAR_RANGE_M } from '../radarConfig';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function fitRadar(map: L.Map, points: MapPlayer[]) {
  const me = points.find((point) => point.isMe);
  if (!me) return;
  const bounds = L.latLng(me.lat, me.lng).toBounds(RADAR_RANGE_M * 2);
  // Fractional zoom preserves the configured radius, including after a resize.
  map.setView([me.lat, me.lng], map.getBoundsZoom(bounds), { animate: false });
}

export function radarMapPoints(points: MapPlayer[]) {
  const me = points.find((point) => point.isMe);
  if (!me) return [];
  const origin = L.latLng(me.lat, me.lng);
  // Allow sub-micrometre floating-point error at the inclusive range boundary.
  return points.filter((point) => origin.distanceTo([point.lat, point.lng]) <= RADAR_RANGE_M + 1e-6);
}

function fitPlayers(map: L.Map, points: MapPlayer[]) {
  if (!points.length) return;
  const bounds = L.latLngBounds(points.flatMap((point) => {
    const area = L.latLng(point.lat, point.lng).toBounds(Math.max(20, point.accuracy_m * 2));
    return [area.getSouthWest(), area.getNorthEast()];
  }));
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17, animate: false });
}

export function MapCanvas({ points: allPoints, mode = 'full' }: { points: MapPlayer[]; mode?: 'full' | 'radar' }) {
  const compact = mode === 'radar';
  const points = compact ? radarMapPoints(allPoints) : allPoints;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.Marker; circle: L.Circle; label: HTMLElement; style: string }>());
  const fittedRef = useRef(false);
  const exploredRef = useRef(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const [hasView, setHasView] = useState(false);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, minZoom: 1, maxZoom: compact ? 28 : 19,
      ...(compact ? { zoomSnap: 0, dragging: false, touchZoom: false, doubleClickZoom: false,
        scrollWheelZoom: false, boxZoom: false, keyboard: false, zoomAnimation: false } : {}) });
    mapRef.current = map;
    // Enlarge existing street tiles for the radar's close-up view.
    const tiles = L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19,
      ...(compact ? { maxZoom: 28, maxNativeZoom: 19 } : {}) }).addTo(map);
    tilesRef.current = tiles;
    tiles.on('tileerror', () => setTileError(true));
    if (compact) map.attributionControl.setPrefix(false);
    else L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    const markExplored = () => { exploredRef.current = true; };
    const container = containerRef.current;
    for (const event of ['pointerdown', 'wheel', 'keydown']) container.addEventListener(event, markExplored, { passive: true });
    const resize = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      if (compact) { fitRadar(map, pointsRef.current); return; }
      // A newly opened dialog can settle to a different size after its first paint.
      if (fittedRef.current && !exploredRef.current) fitPlayers(map, pointsRef.current);
    });
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      for (const event of ['pointerdown', 'wheel', 'keydown']) container.removeEventListener(event, markExplored);
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      markersRef.current.clear();
      fittedRef.current = false;
      exploredRef.current = false;
    };
  }, [compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ids = new Set(points.map((point) => point.player_id));
    for (const [id, entry] of markersRef.current) {
      if (!ids.has(id)) {
        entry.marker.remove();
        entry.circle.remove();
        markersRef.current.delete(id);
      }
    }
    for (const point of points) {
      const position: L.LatLngTuple = [point.lat, point.lng];
      const color = point.role === 'runner' ? '#2563eb' : '#dc2626';
      const faded = point.aging || point.lastKnown;
      const style = `${point.role}${point.isMe ? ' me' : ''}${point.lastKnown ? ' last-known' : point.aging ? ' aging' : ''}`;
      let entry = markersRef.current.get(point.player_id);
      if (!entry) {
        const label = document.createElement('span');
        const marker = L.marker(position, { keyboard: !compact, title: point.isMe ? `${point.name} (You)` : point.name });
        marker.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -12], className: 'map-player-label' });
        const circle = L.circle(position, { radius: point.accuracy_m, color, weight: 1, fillOpacity: 0.1 }).addTo(map);
        entry = { marker, circle, label, style: '' };
        markersRef.current.set(point.player_id, entry);
      }
      entry.label.textContent = `${point.isMe ? 'You' : point.name} · ${point.role === 'runner' ? 'Runner' : 'Catcher'}${point.lastKnown ? ' · last known' : point.aging ? ' · aging' : ''}`;
      entry.marker.setLatLng(position);
      if (entry.style !== style) {
        entry.marker.setIcon(L.divIcon({ className: `map-player ${style}`, html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }));
        entry.marker.setOpacity(faded ? 0.55 : 1);
        entry.style = style;
      }
      if (!map.hasLayer(entry.marker)) entry.marker.addTo(map);
      entry.circle.setLatLng(position).setRadius(point.accuracy_m)
        .setStyle({ color, opacity: faded ? 0.35 : 0.65, fillOpacity: faded ? 0.05 : 0.1 });
    }
    if (compact && points.length) {
      map.invalidateSize({ pan: false });
      fitRadar(map, points);
    } else if (!compact && !fittedRef.current && points.length) {
      map.invalidateSize({ pan: false });
      fitPlayers(map, points);
      fittedRef.current = true;
      setHasView(true);
    }
  }, [points, compact]);

  const me = points.find((point) => point.isMe);
  return (
    <>
      <div className="street-map" ref={containerRef} aria-label={compact ? `North-up street map, ${RADAR_RANGE_M} metre radius` : 'Street map of game players'} />
      {!compact && <div className="map-controls" aria-label="Map controls">
        <div className="map-zoom-controls">
          <button disabled={!hasView} onClick={() => { exploredRef.current = true; mapRef.current?.zoomIn(); }} aria-label="Zoom in">+</button>
          <button disabled={!hasView} onClick={() => { exploredRef.current = true; mapRef.current?.zoomOut(); }} aria-label="Zoom out">−</button>
        </div>
        <button disabled={!me} onClick={() => { exploredRef.current = true; if (me) mapRef.current?.setView([me.lat, me.lng], 16, { animate: false }); }}>
          <UiIcon name="location" size={18} />My location
        </button>
        <button disabled={!points.length} onClick={() => { exploredRef.current = false; if (mapRef.current) fitPlayers(mapRef.current, points); }}>
          <UiIcon name="users" size={18} />Show everyone
        </button>
      </div>}
      {tileError && <div className="map-tile-error" role="status">
        Streets could not load. Player locations still update.
        <button onClick={() => { setTileError(false); tilesRef.current?.redraw(); }}>Retry streets</button>
      </div>}
    </>
  );
}
