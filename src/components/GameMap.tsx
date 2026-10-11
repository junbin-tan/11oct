import { lazy, Suspense } from 'react';
import type { GpsStatus as Status } from '../hooks/useGeolocation';
import { useGameMap } from '../hooks/useGameMap';
import type { MapPoint, PlayerSummary } from '../types';
import { GpsStatus } from '../views/GpsStatus';
import { ModalDialog } from './ModalDialog';
import { UiIcon } from './UiIcon';

const MapCanvas = lazy(() => import('./MapCanvas').then((m) => ({ default: m.MapCanvas })));

export interface MapPlayer extends MapPoint {
  name: string;
  role: PlayerSummary['role'];
  isMe: boolean;
  aging: boolean;
  lastKnown?: boolean;
}

interface GameMapProps {
  players: PlayerSummary[];
  myId: string;
  nowMs: number;
  visible: boolean;
  gpsStatus: Status;
  onEnableGps: () => void;
  onResetGps: () => void;
  onClose: () => void;
}

export function GameMap({ players, myId, nowMs, visible, gpsStatus, onEnableGps, onResetGps, onClose }: GameMapProps) {
  const { snapshot, reconnecting } = useGameMap(visible);
  const byId = new Map(players.map((player) => [player.id, player]));
  const points: MapPlayer[] = (snapshot?.points ?? []).flatMap((point) => {
    const player = byId.get(point.player_id);
    if (!player || player.left_at != null || nowMs - point.captured_at > 30_000) return [];
    return [{ ...point, name: player.name, role: player.role, isMe: player.id === myId,
      aging: nowMs - point.captured_at > 15_000 }];
  });
  const plottedIds = new Set(points.map((point) => point.player_id));
  const unavailable = players.filter((player) => player.left_at == null && !plottedIds.has(player.id));

  return (
    <ModalDialog label="Game map" variant="map" onClose={onClose}>
      <div className="map-shell">
        <header className="modal-topbar">
          <button className="icon-button" onClick={onClose} aria-label="Close map"><UiIcon name="close" /></button>
          <span className="modal-title">Game map</span>
          <span className="topbar-spacer" />
        </header>
        <div className="map-summary">
          <div className="map-summary-heading">
            <strong>{points.length} of {players.length} on map</strong>
            <div className="radar-legend" aria-label="Map legend">
              <span><i className="map-legend-me" aria-hidden />You</span>
              <span><i className="legend-marker runner" aria-hidden />Runner</span>
              <span><i className="legend-marker catcher" aria-hidden />Catcher</span>
            </div>
          </div>
          <p className="map-status" role="status">
            {reconnecting ? 'Connection lost. Retrying map…' : !snapshot ? 'Loading player locations…'
              : `All game players · Updated ${Math.max(0, Math.floor((nowMs - snapshot.snapshot_at) / 1000))}s ago`}
          </p>
          {!plottedIds.has(myId) && <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />}
        </div>
        <div className="map-stage">
          <Suspense fallback={<div className="map-waiting" role="status">Loading street map…</div>}>
            <MapCanvas points={points} />
          </Suspense>
          {snapshot && points.length === 0 && <div className="map-empty" role="status">Waiting for fresh GPS locations…</div>}
        </div>
        <footer className="map-footer">
          <p>Locations are approximate. Circles show GPS accuracy; faded markers are over 15s old.</p>
          {snapshot && unavailable.length > 0 && <p>No fresh GPS: {unavailable.map((p) => p.id === myId ? 'You' : p.name).join(', ')}</p>}
        </footer>
      </div>
    </ModalDialog>
  );
}
