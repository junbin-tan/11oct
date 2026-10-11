import { lazy, Suspense, useEffect, useState } from 'react';
import { useGameMap } from '../hooks/useGameMap';
import { RADAR_RANGE_M } from '../radarConfig';
import type { MapPoint, PlayerSummary } from '../types';
import type { MapPlayer } from './GameMap';

const MapCanvas = lazy(() => import('./MapCanvas').then((m) => ({ default: m.MapCanvas })));

interface RadarMapProps {
  players: PlayerSummary[];
  myId: string;
  nowMs: number;
  visible: boolean;
}

export function RadarMap(props: RadarMapProps) {
  return <PlayerRadarMap key={props.myId} {...props} />;
}

function PlayerRadarMap({ players, myId, nowMs, visible }: RadarMapProps) {
  const { snapshot, reconnecting } = useGameMap(visible);
  const [lastKnownSelf, setLastKnownSelf] = useState<MapPoint | null>(null);
  const byId = new Map(players.map((player) => [player.id, player]));
  const self = [lastKnownSelf, snapshot?.last_known_self, ...(snapshot?.points ?? [])]
    .filter((point): point is MapPoint => point != null && point.player_id === myId)
    .reduce<MapPoint | null>((latest, point) => !latest || point.captured_at > latest.captured_at ? point : latest, null);
  useEffect(() => {
    if (self && self !== lastKnownSelf) setLastKnownSelf(self);
  }, [self, lastKnownSelf]);

  const points: MapPlayer[] = (snapshot?.points ?? []).flatMap((point) => {
    const player = byId.get(point.player_id);
    if (point.player_id === myId || !player || player.left_at != null || nowMs - point.captured_at > 30_000) return [];
    return [{ ...point, name: player.name, role: player.role, isMe: player.id === myId,
      aging: nowMs - point.captured_at > 15_000 }];
  });
  const me = byId.get(myId);
  const selfStale = self != null && nowMs - self.captured_at > 30_000;
  if (self && me && me.left_at == null) {
    points.push({ ...self, name: me.name, role: me.role, isMe: true,
      aging: nowMs - self.captured_at > 15_000, lastKnown: selfStale });
  }
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
        {hasOrigin && (selfStale || reconnecting) && <div className="radar-map-reconnecting" role="status">
          {selfStale && <span>Showing your last known location · Refreshing GPS…</span>}
          {reconnecting && <span>Connection lost. Retrying map…</span>}
        </div>}
        <span className="radar-map-range">{RADAR_RANGE_M} m</span>
      </div>
    </div>
  );
}
