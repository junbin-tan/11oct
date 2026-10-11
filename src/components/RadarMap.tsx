import { lazy, Suspense } from 'react';
import { useGameMap } from '../hooks/useGameMap';
import type { PlayerSummary } from '../types';
import type { MapPlayer } from './GameMap';

const MapCanvas = lazy(() => import('./MapCanvas').then((m) => ({ default: m.MapCanvas })));

interface RadarMapProps {
  players: PlayerSummary[];
  myId: string;
  nowMs: number;
  visible: boolean;
}

export function RadarMap({ players, myId, nowMs, visible }: RadarMapProps) {
  const { snapshot, reconnecting } = useGameMap(visible);
  const byId = new Map(players.map((player) => [player.id, player]));
  const points: MapPlayer[] = (snapshot?.points ?? []).flatMap((point) => {
    const player = byId.get(point.player_id);
    if (!player || player.left_at != null || nowMs - point.captured_at > 30_000) return [];
    return [{ ...point, name: player.name, role: player.role, isMe: player.id === myId,
      aging: nowMs - point.captured_at > 15_000 }];
  });
  const hasOrigin = points.some((point) => point.isMe);

  return (
    <div className="radar radar-map">
      <span className="radar-map-north" aria-hidden="true">N</span>
      <div className="radar-map-circle">
        {hasOrigin ? (
          <Suspense fallback={<div className="radar-map-waiting" role="status">Loading street map…</div>}>
            <MapCanvas points={points} mode="radar" />
          </Suspense>
        ) : <div className="radar-map-waiting" role="status">
          {reconnecting ? 'Connection lost. Retrying map…' : !snapshot ? 'Loading player locations…' : 'Waiting for your fresh GPS location…'}
        </div>}
        {hasOrigin && reconnecting && <div className="radar-map-reconnecting" role="status">Connection lost. Retrying map…</div>}
        <span className="radar-map-range">500 m</span>
      </div>
    </div>
  );
}
