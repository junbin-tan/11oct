import { formatDuration } from '../hooks/useNow';
import { plural } from '../plural';
import type { GameState } from '../types';

interface ResultsProps {
  state: GameState;
  onNewGame: () => void;
}

export function Results({ state, onNewGame }: ResultsProps) {
  const { game, players, me } = state;
  const duration = game.started_at && game.ended_at ? game.ended_at - game.started_at : 0;
  const totalTags = players.reduce((sum, p) => sum + p.tag_count, 0);
  const survivors = players.filter((p) => p.role === 'runner');
  const ranked = [...players].sort((a, b) => b.tag_count - a.tag_count || a.name.localeCompare(b.name));

  return (
    <main className="screen results">
      <h1>Game over</h1>
      <p className="lede">
        {survivors.length === 0
          ? 'Everyone was caught.'
          : `${survivors.map((p) => p.name).join(', ')} survived.`}
      </p>
      <div className="stats">
        <span>{formatDuration(duration)} played</span>
        <span>{plural(totalTags, 'tag')}</span>
      </div>

      <ul className="roster">
        {ranked.map((p) => (
          <li key={p.id}>
            <span className={`role-dot ${p.role}`} aria-hidden />
            <strong>{p.name}</strong>
            {p.id === me.player_id && <span className="muted"> (you)</span>}
            <span className="muted">
              {p.role === 'catcher' ? (p.caught_at ? 'Caught' : 'First catcher') : 'Survived'} · {plural(p.tag_count, 'tag')}
            </span>
          </li>
        ))}
      </ul>

      <button className="btn" onClick={onNewGame}>New game</button>
    </main>
  );
}
