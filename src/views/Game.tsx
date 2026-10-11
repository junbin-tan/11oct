import { lazy, Suspense, useEffect, useState } from 'react';
import { ExitButton } from '../components/ExitButton';
import { GameCharacter } from '../components/GameCharacter';
import { GameMap } from '../components/GameMap';
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
  visible?: boolean;
  nowMs: number;
  gpsStatus: Status;
  busy: boolean;
  onEnableGps: () => void;
  onResetGps: () => void;
  onTag: (input: { payload: string } | { code: string }) => Promise<string | null>;
  onEnd: () => void;
  onExit: () => Promise<string | null>;
}

export function Game({ state, radar, radarReconnecting, visible = true, nowMs, gpsStatus, busy, onEnableGps, onResetGps, onTag, onEnd, onExit }: GameProps) {
  const [modal, setModal] = useState<'qr' | 'scan' | 'map' | null>(null);
  const { me, game, players, events } = state;
  const remainingMs = Math.max(0, (game.ends_at ?? nowMs) - nowMs);
  const deadlineReached = game.ends_at !== null && remainingMs === 0;
  useEffect(() => {
    if (deadlineReached) setModal(null);
  }, [deadlineReached]);
  const isCatcher = me.role === 'catcher';
  const catchers = players.filter((p) => p.role === 'catcher').length;
  const runners = players.length - catchers;
  const runnerShare = players.length > 0 ? (runners / players.length) * 100 : 0;
  const catcherShare = players.length > 0 ? (catchers / players.length) * 100 : 0;
  const gpsNeedsAttention = gpsStatus !== 'active' && gpsStatus !== 'sharing' && gpsStatus !== 'requesting';

  const handleTag = async (input: { payload: string } | { code: string }) => {
    if (deadlineReached) return 'Time’s up! The round has ended.';
    const error = await onTag(input);
    if (!error) setModal(null);
    return error;
  };

  return (
    <main className="screen game has-action-dock">
      <div className="screen-bar game-exit-bar">
        <p className="eyebrow">Room {game.code}</p>
        <ExitButton phase="game" isHost={me.is_host} busy={busy} onExit={onExit} />
      </div>
      <section className="game-hud" aria-label="Your role and game status">
        <header key={me.role} className={`role-hero ${me.role}`}>
          <GameCharacter role={me.role} className="role-character" />
          <div className="role-copy">
            <p className="eyebrow">You are a</p>
            <h1 className="role-label">{isCatcher ? 'Catcher' : 'Runner'}</h1>
            <p className="role-hint">{isCatcher ? 'Find a Runner. Scan. Got ’em!' : 'Keep moving. Don’t get scanned.'}</p>
          </div>
        </header>

        <div className="metric-strip" aria-label="Game status">
          <span className="runner-metric"><strong>{runners}</strong><small>{runners === 1 ? 'Runner' : 'Runners'}</small></span>
          <span className="catcher-metric"><strong>{catchers}</strong><small>{catchers === 1 ? 'Catcher' : 'Catchers'}</small></span>
          <span className={`time-left${remainingMs <= 60_000 ? ' running-low' : ''}`} role="timer" aria-label="Time left"><strong>{formatDuration(Math.ceil(remainingMs / 1000) * 1000)}</strong><small>Time left</small></span>
        </div>
        <div className="team-balance" aria-hidden="true">
          <span className="runner-segment" style={{ width: `${runnerShare}%` }} />
          <span className="catcher-segment" style={{ width: `${catcherShare}%` }} />
        </div>
      </section>

      {gpsNeedsAttention && <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />}

      <Radar key={`${game.code}:${me.player_id}`} radar={radar} players={players} myId={me.player_id} visible={visible && !deadlineReached}
        nowMs={nowMs} reconnecting={radarReconnecting} />

      {!gpsNeedsAttention && <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />}

      {events.length > 0 && (
        <section className="activity-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live updates</p>
              <h2>Got ’em!</h2>
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
            disabled={busy || deadlineReached}
            onClick={() => {
              if (window.confirm('End the game for everyone?')) onEnd();
            }}
          >
            End game
          </button>
        )}
      </details>

      <div className={`action-dock role-dock ${me.role}`}>
        <button className="btn dock-map-action" disabled={deadlineReached} onClick={() => setModal('map')}>
          <UiIcon name="map" />Map
        </button>
        <button className="btn role-primary dock-action" disabled={deadlineReached} onClick={() => setModal(isCatcher ? 'scan' : 'qr')}>
          <UiIcon name={isCatcher ? 'scan' : 'qr'} />
          {isCatcher ? 'Scan to tag' : 'Show my QR'}
        </button>
      </div>

      {!deadlineReached && modal === 'map' && (
        <GameMap players={players} myId={me.player_id} nowMs={nowMs} visible={visible}
          gpsStatus={gpsStatus} onEnableGps={onEnableGps} onResetGps={onResetGps} onClose={() => setModal(null)} />
      )}
      {!deadlineReached && modal === 'qr' && (
        <PlayerQr name={me.name} payload={me.qr_payload} tagCode={me.tag_code} onClose={() => setModal(null)} />
      )}
      {!deadlineReached && modal === 'scan' && isCatcher && (
        <Suspense fallback={<div className="modal-fallback" role="status"><div className="modal-card">Starting camera…</div></div>}>
          <QrScanner onSubmit={handleTag} onClose={() => setModal(null)} />
        </Suspense>
      )}
    </main>
  );
}
