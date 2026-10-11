import { lazy, Suspense, useState } from 'react';
import { PlayerQr } from '../components/PlayerQr';
import { Radar } from '../components/Radar';
import type { GpsStatus as Status } from '../hooks/useGeolocation';
import { formatDuration } from '../hooks/useNow';
import { plural } from '../plural';
import type { GameState, RadarResponse } from '../types';
import { GpsStatus } from './GpsStatus';

const QrScanner = lazy(() => import('../components/QrScanner').then((m) => ({ default: m.QrScanner })));

interface GameProps {
  state: GameState;
  radar: RadarResponse | null;
  nowMs: number;
  gpsStatus: Status;
  busy: boolean;
  onEnableGps: () => void;
  onResetGps: () => void;
  onTag: (input: { payload: string } | { code: string }) => Promise<string | null>;
  onEnd: () => void;
}

export function Game({ state, radar, nowMs, gpsStatus, busy, onEnableGps, onResetGps, onTag, onEnd }: GameProps) {
  const [modal, setModal] = useState<'qr' | 'scan' | null>(null);
  const { me, game, players, events } = state;
  const isCatcher = me.role === 'catcher';
  const catchers = players.filter((p) => p.role === 'catcher').length;
  const runners = players.length - catchers;

  const handleTag = async (input: { payload: string } | { code: string }) => {
    const error = await onTag(input);
    if (!error) setModal(null);
    return error;
  };

  return (
    <main className="screen game">
      <header className="role-header">
        <p className="eyebrow">Your role</p>
        <p className="role-label">{isCatcher ? 'Catcher' : 'Runner'}</p>
        <p className="role-hint">{isCatcher ? 'Find runners and scan their QR.' : 'Stay away from catchers.'}</p>
      </header>

      <div className="stats">
        <span>{plural(runners, 'runner')}</span>
        <span>{plural(catchers, 'catcher')}</span>
        <span>{formatDuration(nowMs - (game.started_at ?? nowMs))}</span>
      </div>

      {gpsStatus !== 'active' && (
        <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />
      )}

      <Radar radar={radar} players={players} nowMs={nowMs} />

      <button className="btn primary primary-action" onClick={() => setModal(isCatcher ? 'scan' : 'qr')}>
        {isCatcher ? 'Scan to tag' : 'Show my QR'}
      </button>

      {events.length > 0 && (
        <section>
          <h2>Recent tags</h2>
          <ul className="feed">
            {events.slice(0, 5).map((e) => (
              <li key={e.id}>
                <strong>{e.catcher_name}</strong> caught <strong>{e.tagged_name}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="room-panel">
        <summary>Room {game.code}</summary>
        <ul className="roster">
          {players.map((p) => (
            <li key={p.id}>
              <span className={`role-dot ${p.role}`} aria-hidden />
              <strong>{p.name}</strong>
              <span className="muted">{p.role === 'catcher' ? 'Catcher' : 'Runner'}</span>
              {p.tag_count > 0 && <span className="muted"> · {plural(p.tag_count, 'tag')}</span>}
            </li>
          ))}
        </ul>
        {me.is_host && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('End the game for everyone?')) onEnd();
            }}
          >
            End game
          </button>
        )}
      </details>

      {modal === 'qr' && (
        <PlayerQr name={me.name} payload={me.qr_payload} tagCode={me.tag_code} onClose={() => setModal(null)} />
      )}
      {modal === 'scan' && isCatcher && (
        <Suspense fallback={<div className="modal-fallback" role="status"><div className="modal-card">Starting camera…</div></div>}>
          <QrScanner onSubmit={handleTag} onClose={() => setModal(null)} />
        </Suspense>
      )}
    </main>
  );
}
