import { useState } from 'react';
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
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/?room=${code}`;
}

export function Lobby({ state, gpsStatus, busy, onEnableGps, onResetGps, onStart }: LobbyProps) {
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
    <main className="screen lobby">
      <header className="room-anchor">
        <span className="anchor-star" aria-hidden>✦</span>
        <p className="eyebrow">Room code</p>
        <p className="room-code">{game.code}</p>
        <p className="fine-print">Share this signal with the players joining your hunt.</p>
      </header>
      <button className="btn secondary" onClick={copyInvite}>
        {copied ? 'Invite ready!' : 'Share invite link'}
      </button>

      <h2>Players ({players.length})</h2>
      <ul className="roster">
        {players.map((p) => (
          <li key={p.id}>
            <span className={`gps-dot ${p.gps_ready ? 'ready' : ''}`} title={p.gps_ready ? 'GPS ready' : 'No GPS yet'} />
            <strong>{p.name}</strong>
            {p.id === me.player_id && <span className="muted"> (you)</span>}
            {p.is_host && <span className="badge catcher">First catcher</span>}
          </li>
        ))}
      </ul>

      <GpsStatus status={gpsStatus} onEnable={onEnableGps} onResetGps={onResetGps} />

      {me.is_host ? (
        <button className="btn primary" disabled={busy || players.length < 2} onClick={onStart}>
          {players.length < 2 ? 'Waiting for players…' : 'Start game'}
        </button>
      ) : (
        <p className="waiting">Waiting for the host to start…</p>
      )}
    </main>
  );
}
