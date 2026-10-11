import { useState, type FormEvent } from 'react';

const NAME_KEY = 'gps-tag:name';

interface HomeProps {
  initialCode: string;
  busy: boolean;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

export function Home({ initialCode, busy, onCreate, onJoin }: HomeProps) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [mode, setMode] = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [code, setCode] = useState(initialCode);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && (mode === 'create' || code.trim().length === 6) && !busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    localStorage.setItem(NAME_KEY, trimmed);
    if (mode === 'create') onCreate(trimmed);
    else onJoin(code.trim(), trimmed);
  };

  return (
    <main className="screen home">
      <header className="home-hero">
        <div className="game-mark" aria-hidden>
          <span className="game-mark-ring ring-one" />
          <span className="game-mark-ring ring-two" />
          <span className="game-mark-player runner" />
          <span className="game-mark-player catcher" />
        </div>
        <p className="eyebrow">Run · Scan · Recruit</p>
        <h1>GPS Tag</h1>
        <p className="lede">The real-world chase game where every catch grows the hunting team.</p>
      </header>

      <form onSubmit={submit} className="join-card stack">
        <div className="segmented" role="tablist" aria-label="Game action">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'active' : ''}
            onClick={() => setMode('create')}
          >
            Create
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={mode === 'join' ? 'active' : ''}
            onClick={() => setMode('join')}
          >
            Join
          </button>
        </div>

        <div className="form-intro">
          <h2>{mode === 'create' ? 'Start a new chase' : 'Join the chase'}</h2>
          <p>{mode === 'create' ? 'You’ll begin as the first Catcher.' : 'Enter the code your host shared.'}</p>
        </div>

        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="e.g. Alex"
            required
          />
        </label>

        {mode === 'join' && (
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABC123"
              className="code-input"
            />
          </label>
        )}

        <button className="btn primary" disabled={!canSubmit}>
          {busy ? 'Please wait…' : mode === 'create' ? 'Create game' : 'Join game'}
        </button>
      </form>

      <p className="privacy-note">
        GPS works only while the game is open. We keep your latest position, never your route.
      </p>
    </main>
  );
}
