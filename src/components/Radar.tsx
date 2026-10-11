import type { PlayerSummary, RadarResponse } from '../types';

export const RADAR_RANGE_M = 500;
const SIZE = 300;
const CENTER = SIZE / 2;
const PLOT_RADIUS = 136;
const APPROXIMATE_ACCURACY_M = 50;
const STALE_FIX_S = 30;

export function radarPosition(distanceM: number, bearingDeg: number) {
  const r = (Math.min(distanceM, RADAR_RANGE_M) / RADAR_RANGE_M) * PLOT_RADIUS;
  const b = (bearingDeg * Math.PI) / 180;
  return { x: CENTER + r * Math.sin(b), y: CENTER - r * Math.cos(b) };
}

interface RadarProps {
  radar: RadarResponse | null;
  players: PlayerSummary[];
  nowMs: number;
}

export function Radar({ radar, players, nowMs }: RadarProps) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const points = (radar?.points ?? [])
    .map((point) => ({ point, player: byId.get(point.player_id) }))
    .filter((entry): entry is { point: typeof entry.point; player: PlayerSummary } => !!entry.player);

  const lastPingS = radar?.snapshot_at ? Math.max(0, Math.round((nowMs - radar.snapshot_at) / 1000)) : null;
  const nextPingS = radar?.next_ping_at ? Math.max(0, Math.ceil((radar.next_ping_at - nowMs) / 1000)) : null;

  return (
    <section className="radar-panel" aria-label="Radar">
      <svg className="radar" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="North-up radar, 500 metre range">
        <circle cx={CENTER} cy={CENTER} r={PLOT_RADIUS + 4} className="radar-bg" />
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} cx={CENTER} cy={CENTER} r={PLOT_RADIUS * f} className="radar-ring" />
        ))}
        <line x1={CENTER} y1={CENTER - PLOT_RADIUS} x2={CENTER} y2={CENTER + PLOT_RADIUS} className="radar-axis" />
        <line x1={CENTER - PLOT_RADIUS} y1={CENTER} x2={CENTER + PLOT_RADIUS} y2={CENTER} className="radar-axis" />
        <text x={CENTER} y={12} className="radar-north">N</text>
        <text x={CENTER + 4} y={CENTER - PLOT_RADIUS / 2 + 12} className="radar-scale">250 m</text>
        <text x={CENTER + 4} y={CENTER - PLOT_RADIUS + 12} className="radar-scale">500 m</text>
        <circle cx={CENTER} cy={CENTER} r={6} className="radar-me" />
        {points.map(({ point, player }) => {
          const { x, y } = radarPosition(point.distance_m, point.bearing_deg);
          return (
            <g key={point.player_id}>
              {player.role === 'catcher' ? (
                <rect x={x - 7} y={y - 7} width={14} height={14} rx={2} className="radar-dot catcher" transform={`rotate(45 ${x} ${y})`} />
              ) : (
                <circle cx={x} cy={y} r={8} className="radar-dot runner" />
              )}
              <text x={x} y={y - 12} className="radar-label">{player.name}</text>
            </g>
          );
        })}
      </svg>

      <p className="radar-meta">
        {!radar
          ? 'Loading radar…'
          : !radar.origin_available
            ? 'Waiting for your GPS…'
            : `Ping ${lastPingS}s ago · next in ${nextPingS}s`}
        {radar && (radar.missing_gps_count > 0 || radar.outside_range_count > 0) && (
          <span>
            {' '}· {radar.outside_range_count} out of range · {radar.missing_gps_count} no GPS
          </span>
        )}
      </p>

      {points.length > 0 && (
        <ul className="nearby">
          {points
            .sort((a, b) => a.point.distance_m - b.point.distance_m)
            .map(({ point, player }) => (
              <li key={point.player_id}>
                <span className={`role-dot ${player.role}`} aria-hidden />
                <strong>{player.name}</strong>
                <span>{player.role === 'catcher' ? 'Catcher' : 'Runner'}</span>
                <span>
                  {point.distance_m} m
                  {point.accuracy_m !== null && point.accuracy_m > APPROXIMATE_ACCURACY_M && ' (approx.)'}
                  {point.fix_age_s > STALE_FIX_S && ` · ${point.fix_age_s}s old`}
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
