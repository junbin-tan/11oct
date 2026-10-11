import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CtfState, Landmark, Position } from '../../server/ctf/types';

const ink = '#241b35';
const runner = '#2563eb';
const catcher = '#dc2626';
const flag = '#ffd166';
const capturedFlag = '#286340';
const boundary = '#7650b2';

interface Props {
  start: Position | null;
  flags: Array<Landmark & { captured_at?: number | null }>;
  players: CtfState['players'];
  selfId: string;
  onPlace?: (position: Position) => void;
}

export function CtfMap({ start, flags, players, selfId, onPlace }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const place = useRef(onPlace);
  place.current = onPlace;
  const fitted = useRef('');
  const self = players.find((p) => p.id === selfId)?.location;
  const center = start ?? self ?? null;

  useEffect(() => {
    if (!container.current || !center || mapRef.current) return;
    const map = L.map(container.current, { maxZoom: 21 });
    mapRef.current = map;
    L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: import.meta.env.VITE_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 19,
      maxZoom: 21,
    }).addTo(map).on('tileerror', () => { if (container.current) container.current.dataset.tileError = 'true'; });
    layer.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => place.current?.({ lat: event.latlng.lat, lng: event.latlng.lng }));
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; layer.current = null; fitted.current = ''; };
  // Initialize when the first GPS/start location is available, not on every movement.
  }, [!!center]);

  useEffect(() => {
    const map = mapRef.current;
    const group = layer.current;
    if (!map || !group || !center) return;
    group.clearLayers();
    const key = start ? `${start.lat},${start.lng}` : 'gps';
    if (fitted.current !== key) {
      map.fitBounds(L.latLng(center.lat, center.lng).toBounds(240), { padding: [15, 15] });
      fitted.current = key;
    }
    if (start) {
      L.circle([start.lat, start.lng], { radius: 100, color: boundary, weight: 3, fillColor: boundary, fillOpacity: 0.08 }).addTo(group);
      L.circleMarker([start.lat, start.lng], { radius: 6, color: ink, weight: 3, fillColor: flag, fillOpacity: 1 }).bindTooltip('Start', { permanent: true }).addTo(group);
    }
    flags.forEach((item, i) => {
      const captured = item.captured_at != null;
      const label = document.createElement('span');
      label.textContent = `${i + 1}. ${item.name}${captured ? ' · captured' : ''}`;
      L.circle([item.lat, item.lng], { radius: 15, color: captured ? capturedFlag : ink, fillColor: captured ? capturedFlag : flag, fillOpacity: 0.22, weight: 2 }).addTo(group);
      L.marker([item.lat, item.lng], {
        icon: L.divIcon({ className: `ctf-flag-marker${captured ? ' ctf-captured' : ''}`, html: `<span>${captured ? '✓' : i + 1}</span>`, iconSize: [28, 32] }),
      }).bindTooltip(label).addTo(group);
    });
    players.forEach((p) => {
      if (!p.location || p.left) return;
      const label = document.createElement('span');
      label.textContent = `${p.name}${p.id === selfId ? ' (you)' : ''} · ${p.role}`;
      L.circleMarker([p.location.lat, p.location.lng], {
        radius: p.id === selfId ? 9 : 7,
        color: p.id === selfId ? ink : '#fff',
        weight: 3,
        fillColor: p.role === 'catcher' ? catcher : runner,
        fillOpacity: 1,
      }).bindTooltip(label).addTo(group);
    });
  }, [center?.lat, center?.lng, start, flags, players, selfId]);

  return (
    <section className="radar-panel ctf-map-panel" aria-label="Capture the Flag play area">
      <div className="radar-heading">
        <div><span className="live-dot" aria-hidden />Play area</div>
        <div className="radar-legend">
          <span><i className="legend-marker runner" />Runner</span>
          <span><i className="legend-marker catcher" />Catcher</span>
          <span><i className="ctf-legend-flag" />Flag</span>
          <span><i className="ctf-legend-boundary" />100 m</span>
        </div>
      </div>
      <div className={`ctf-map-stage${onPlace ? ' ctf-placing' : ''}`}>
        <div ref={container} className="ctf-map" aria-label="Capture the Flag play area map" />
        {!center && <p className="map-empty">Enable GPS to see the starting area.</p>}
        <p className="map-tile-error ctf-tile-error">Street tiles could not load. Flags and player markers still work.</p>
      </div>
    </section>
  );
}
