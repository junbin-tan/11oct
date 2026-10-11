import { useState } from 'react';
import { ExitButton } from '../components/ExitButton';
import { GameCharacter } from '../components/GameCharacter';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { UiIcon } from '../components/UiIcon';
import type { GpsStatus as Status } from '../hooks/useGeolocation';
import type { GameState } from '../types';
import { GpsStatus } from './GpsStatus';

interface LobbyProps {
  state: GameState;
  gpsStatus: Status;
  busy: boolean;
  onEnableGps: () => void;
  onResetGps: () => void;
  onStart: () => void;
  onDurationChange: (minutes: number) => void;
  onExit: () => Promise<string | null>;
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/?room=${code}`;
}

export function Lobby({ state, gpsStatus, busy, onEnableGps, onResetGps, onStart, onDurationChange, onExit }: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const { game, me, players } = state;

  const copyInvite = async () => {
    const url = inviteUrl(game.code);
    try {
      if (navigator.share) await navigator.share({ title: 'Join my GPS Tag game', url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // User dismissed the share sheet.
    }
  };

  return (
    <main className="screen lobby has-action-dock">
      <header className="screen-bar">
        <div>
          <p className="eyebrow">GPS Tag</p>
          <h1>Round up the crew.</h1>
        </div>
        <div className="screen-bar-actions">
          <span className="stage-pill">Lobby</span>
          <ExitButton phase="lobby" isHost={me.is_host} busy={busy} onExit={onExit} />
        </div>
      </header>

      <section className="invite-card invite-ticket" aria-labelledby="room-code-label">
        <GameCharacter role="runner" className="ticket-character" />
        <div className="invite-card-copy">
          <p className="eyebrow" id="room-code-label">Room code</p>
          <p className="room-code">{game.code}</p>
          <p className="ticket-caption">Share this room code. Bring your fastest friends.</p>
        </div>
        <div className="ticket-stub">
          <div className="avatar-stack" aria-hidden="true">
            {players.slice(0, 4).map((player) => (
              <PlayerAvatar key={player.id} name={player.name} role={player.role} small />
            ))}
            {players.length > 4 && <span className="avatar-more">+{players.length - 4}</span>}
          </div>
          <div className="ticket-invite">
            <span className="share-feedback" role="status">{copied ? 'Invite ready!' : 'Invite crew'}</span>
            <button className="icon-button share-button" onClick={copyInvite} aria-label="Share invite link">
              <UiIcon name="share" size={20} />
            </button>
          </div>
        </div>
      </section>

      <section className="round-settings" aria-labelledby="round-duration-label">
        <div>
          <p className="eyebrow" id="round-duration-label">Round duration</p>
          <p className="round-goal">Catch everyone in {game.duration_minutes} minutes.</p>
        </div>
        <div className="duration-control">
          {me.is_host && <button className="btn" aria-label="Decrease duration by 30 minutes"
            disabled={busy || game.duration_minutes <= 30} onClick={() => onDurationChange(game.duration_minutes - 30)}>−</button>}
          <output aria-live="polite" aria-label="Round duration">{game.duration_minutes}<small>minutes</small></output>
          {me.is_host && <button className="btn" aria-label="Increase duration by 30 minutes"
            disabled={busy || game.duration_minutes >= 360} onClick={() => onDurationChange(game.duration_minutes + 30)}>+</button>}
        </div>
        <p className="duration-hint">{me.is_host ? 'Choose 30 minutes to 6 hours, in 30-minute steps.' : 'The host chooses the time limit.'} Runners win if time runs out.</p>
      </section>

      <div className="section-heading">
        <div>
          <p className="eyebrow">The starting lineup</p>
          <h2>Players</h2>
        </div>
        <span className="count-pill"><UiIcon name="users" size={15} />{players.length}</span>
      </div>
      <ul className="roster player-roster">
        {players.map((p) => (
          <li key={p.id} className={`player-row ${p.role}`}>
            <PlayerAvatar name={p.name} role={p.role} />
            <span className="player-copy">
              <strong>{p.name}{p.id === me.player_id ? ' (you)' : ''}</strong>
              <span>{p.is_host ? 'First Catcher' : 'Runner'}{p.is_host && <span className="host-badge">Host</span>}</span>
            </span>
            <span className={`readiness ${p.gps_ready ? 'ready' : ''}`} title={p.gps_ready ? 'GPS ready' : 'No GPS yet'}>
              <span aria-hidden />{p.gps_ready ? 'GPS ready' : 'No GPS yet'}
            </span>
          </li>
        ))}
      </ul>

      <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />
      <p className="lobby-instruction">The host starts as Catcher. Everyone else runs!</p>

      <div className="action-dock">
        {me.is_host ? (
          <button className="btn primary dock-action" disabled={busy || players.length < 2} onClick={onStart}>
            <UiIcon name="play" />
            {players.length < 2 ? 'Invite one more to play' : 'Start the chase'}
          </button>
        ) : (
          <p className="waiting-dock"><span className="status-pulse" aria-hidden />Waiting for the host to start…</p>
        )}
      </div>
    </main>
  );
}
