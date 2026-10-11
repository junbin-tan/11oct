import { lazy, Suspense, useState } from 'react';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerQr } from '../components/PlayerQr';
import { Radar } from '../components/Radar';
import { UiIcon } from '../components/UiIcon';
import type { GpsStatus as Status } from '../hooks/useGeolocation';
import { formatDuration } from '../hooks/useNow';
import { plural } from '../plural';
import type { GameState, RadarResponse } from '../types';
import { GpsStatus } from './GpsStatus';

const QrScanner = lazy(() => import('../components/QrScanner').then((m) => ({ default: m.QrScanner })));

interface GameProps {
  state: GameState;
  radar: RadarResponse | null;
  radarReconnecting: boolean;
  nowMs: number;
  gpsStatus: Status;
  busy: boolean;
  onEnableGps: () => void;
  onResetGps: () => void;
  onTag: (input: { payload: string } | { code: string }) => Promise<string | null>;
  onEnd: () => void;
}

export function Game({ state, radar, radarReconnecting, nowMs, gpsStatus, busy, onEnableGps, onResetGps, onTag, onEnd }: GameProps) {
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
    <main className="screen game has-action-dock">
      <header className={`role-hero ${me.role}`}>
        <div className="role-symbol" aria-hidden><span /></div>
        <div className="role-copy">
          <p className="eyebrow">You are a</p>
          <h1 className="role-label">{isCatcher ? 'Catcher' : 'Runner'}</h1>
          <p className="role-hint">{isCatcher ? 'Find a Runner and scan their code.' : 'Keep moving. Don’t get scanned.'}</p>
        </div>
      </header>

      <div className="metric-strip" aria-label="Game status">
        <span><strong>{runners}</strong><small>{runners === 1 ? 'Runner' : 'Runners'}</small></span>
        <span><strong>{catchers}</strong><small>{catchers === 1 ? 'Catcher' : 'Catchers'}</small></span>
        <span><strong>{formatDuration(nowMs - (game.started_at ?? nowMs))}</strong><small>Elapsed</small></span>
      </div>

      <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />

      <Radar radar={radar} players={players} nowMs={nowMs} reconnecting={radarReconnecting} />

      {events.length > 0 && (
        <section className="activity-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live updates</p>
              <h2>Recent tags</h2>
            </div>
          </div>
          <ul className="feed">
            {events.slice(0, 5).map((e) => (
              <li key={e.id}>
                <span className="feed-icon" aria-hidden>!</span>
                <span><strong>{e.catcher_name}</strong> caught <strong>{e.tagged_name}</strong></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="room-panel">
        <summary>Room {game.code}</summary>
        <ul className="roster player-roster compact">
          {players.map((p) => (
            <li key={p.id} className={`player-row ${p.role}`}>
              <PlayerAvatar name={p.name} role={p.role} small />
              <span className="player-copy">
                <strong>{p.name}</strong>
                <span>{p.role === 'catcher' ? 'Catcher' : 'Runner'} · {plural(p.tag_count, 'tag')}</span>
              </span>
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

      <div className={`action-dock role-dock ${me.role}`}>
        <button className="btn role-primary dock-action" onClick={() => setModal(isCatcher ? 'scan' : 'qr')}>
          <UiIcon name={isCatcher ? 'scan' : 'qr'} />
          {isCatcher ? 'Scan to tag' : 'Show my QR'}
        </button>
      </div>

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
