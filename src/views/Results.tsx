import { GameCharacter } from '../components/GameCharacter';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { UiIcon } from '../components/UiIcon';
import { formatDuration } from '../hooks/useNow';
import { plural } from '../plural';
import type { GameState } from '../types';

interface ResultsProps {
  state: GameState;
  onNewGame: () => void;
  busy: boolean;
}

export function Results({ state, onNewGame, busy }: ResultsProps) {
  const { game, players, me } = state;
  const duration = game.started_at && game.ended_at ? game.ended_at - game.started_at : 0;
  const totalTags = players.reduce((sum, p) => sum + p.tag_count, 0);
  const survivors = players.filter((p) => p.role === 'runner' && p.left_at === null);
  const departureEnding = game.end_reason === 'host_left' || game.end_reason === 'players_left';
  const hadDepartures = players.some((p) => p.left_at !== null);
  const caughtAll = survivors.length === 0 && !hadDepartures;
  const ranked = [...players].sort((a, b) => b.tag_count - a.tag_count || a.name.localeCompare(b.name));

  return (
    <main className="screen results has-action-dock">
      <header className={`results-hero ${departureEnding ? 'departure-ending' : survivors.length === 0 ? 'catchers-win' : 'runners-survive'}`}>
        {!departureEnding && <div className="confetti" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>}
        <p className="eyebrow round-complete">{departureEnding ? 'Chase ended' : 'Round complete'}</p>
        <GameCharacter role={survivors.length === 0 ? 'catcher' : 'runner'} className="results-character" celebratory={!departureEnding} />
        <h1 className="results-title">{departureEnding ? 'Game ended' : survivors.length === 0 ? (caughtAll ? 'Caught them all!' : 'No runners remaining') : 'Still running!'}</h1>
        <p>
          {game.end_reason === 'host_left'
            ? 'The host left the game.'
            : game.end_reason === 'players_left'
              ? 'There are no longer enough runners and catchers to continue.'
              : survivors.length === 0
            ? (caughtAll ? 'The Catchers took the whole field.' : 'The chase is over.')
            : `${survivors.map((p) => p.name).join(', ')} survived the chase.`}
        </p>
      </header>

      <div className="result-metrics">
        <span><strong>{formatDuration(duration)}</strong><small>Time played</small></span>
        <span><strong>{totalTags}</strong><small>{totalTags === 1 ? 'Tag' : 'Tags'}</small></span>
        <span><strong>{survivors.length}</strong><small>{survivors.length === 1 ? 'Survivor' : 'Survivors'}</small></span>
      </div>

      <div className="section-heading scoreboard-heading">
        <div>
          <p className="eyebrow">Final standings</p>
          <h2>The scoreboard</h2>
        </div>
        <span className="count-pill"><UiIcon name="users" size={15} />{players.length}</span>
      </div>
      <ol className="roster player-roster results-roster">
        {ranked.map((p, index) => (
          <li key={p.id} className={`player-row ${p.role}${index === 0 ? ' top-score' : ''}`}>
            <span className="rank-number" aria-hidden>{index + 1}</span>
            <PlayerAvatar name={p.name} role={p.role} />
            <span className="player-copy">
              <strong>{p.name}{p.id === me.player_id ? ' (you)' : ''}</strong>
              <span>{p.left_at !== null ? 'Left game' : p.role === 'catcher' ? (p.caught_at ? 'Caught' : 'First Catcher') : 'Survived'}</span>
            </span>
            <strong className="tag-score">{plural(p.tag_count, 'tag')}</strong>
          </li>
        ))}
      </ol>

      <div className="action-dock">
        <button className="btn primary dock-action" disabled={busy} onClick={onNewGame}><UiIcon name="play" />{busy ? 'Leaving…' : 'New game'}</button>
      </div>
    </main>
  );
}
