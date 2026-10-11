import { RadarMap } from './RadarMap';
import type { PlayerSummary, RadarResponse } from '../types';

const AGING_MS = 15_000;
const EXPIRED_MS = 30_000;

interface RadarProps {
  radar: RadarResponse | null;
  players: PlayerSummary[];
  nowMs: number;
  myId: string;
  visible: boolean;
  reconnecting?: boolean;
}

export function Radar({ radar, players, myId, visible, nowMs, reconnecting = false }: RadarProps) {
  const originAge = radar?.origin_captured_at == null ? null : Math.max(0, nowMs - radar.origin_captured_at);
  const originExpired = originAge !== null && originAge > EXPIRED_MS;
  const byId = new Map(players.map((p) => [p.id, p]));
  const points = (radar?.points ?? [])
    .map((point) => ({ point, player: byId.get(point.player_id) }))
    .filter((entry): entry is { point: typeof entry.point; player: PlayerSummary } => !!entry.player)
    .map((entry) => {
      const { point } = entry;
      const age = point.captured_at == null ? null : Math.max(0, nowMs - point.captured_at);
      const expired = originExpired || (age !== null && age > EXPIRED_MS);
      const uncertain = !radar?.origin_available || originAge === null || age === null ||
        point.position_uncertain !== false || point.uncertainty_m == null;
      return { ...entry, age, expired, uncertain, aging: (age ?? 0) > AGING_MS || (originAge ?? 0) > AGING_MS };
    });

  const lastPingS = radar?.snapshot_at != null ? Math.max(0, Math.floor((nowMs - radar.snapshot_at) / 1000)) : null;
  const nextPingS = radar?.next_ping_at != null ? Math.max(0, Math.ceil((radar.next_ping_at - nowMs) / 1000)) : null;

  return (
    <section className="radar-panel" aria-label="Radar">
      <div className="radar-heading">
        <div><span className="live-dot" aria-hidden />Live radar</div>
        <div className="radar-legend" aria-label="Radar legend">
          <span><i className="legend-marker runner" aria-hidden />Runner</span>
          <span><i className="legend-marker catcher" aria-hidden />Catcher</span>
        </div>
      </div>
      <div className="radar-stage">
        <RadarMap players={players} myId={myId} nowMs={nowMs} visible={visible} />
      </div>

      <p className="radar-meta">
        {!radar
          ? 'Loading radar…'
          : !radar.origin_available
            ? 'Waiting for your GPS…'
            : originExpired
              ? 'Your location expired. Finding a fresh reading…'
              : originAge === null
                ? 'Your location age is unknown. Refresh the game to share a fresh reading.'
                : `Updated ${lastPingS}s ago · next in ${nextPingS}s${originAge > AGING_MS ? ' · Your location is aging' : ''}`}
        {radar && (radar.missing_gps_count > 0 || radar.outside_range_count > 0) && (
          <span>
            {' '}· {radar.outside_range_count} out of range · {radar.missing_gps_count} no fresh GPS
          </span>
        )}
      </p>
      {reconnecting && <p className="gps notice" role="status">Connection lost. Retrying radar…</p>}
      {points.some(({ uncertain }) => uncertain) && <p className="radar-meta">Uncertain positions are listed below without a direction.</p>}

      {points.length > 0 && (
        <div className="nearby-section">
          <div className="nearby-title"><strong>Nearby players</strong><span>{points.length}</span></div>
          <ul className="nearby">
            {points
              .sort((a, b) => a.point.distance_m - b.point.distance_m)
              .map(({ point, player, age, expired, uncertain, aging }) => (
              <li key={point.player_id}>
                <span className={`role-dot ${player.role}`} aria-hidden />
                <span className="nearby-player"><strong>{player.name}</strong><small>{player.role === 'catcher' ? 'Catcher' : 'Runner'}</small></span>
                <span className="nearby-distance">
                  {expired ? 'Location expired' : uncertain ? 'Position uncertain' : `≈ ${point.distance_m} m (±${point.uncertainty_m} m)`}
                  {age === null ? ' · age unknown' : ` · ${Math.floor(age / 1000)}s old`}
                  {!expired && aging && ' · aging'}
                </span>
              </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
