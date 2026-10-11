import { GameCharacter } from './GameCharacter';

export function ChaseScene() {
  return (
    <div className="chase-scene" aria-hidden="true">
      <svg className="chase-art" viewBox="0 0 580 260" fill="none" focusable="false">
        <ellipse cx="292" cy="142" rx="244" ry="104" fill="#E9DEFF" />
        <path d="M48 204c79 41 133-36 209-12s141 66 263-12" stroke="#241B35" strokeWidth="3" strokeDasharray="7 10" strokeLinecap="round" />
        <ellipse cx="178" cy="220" rx="59" ry="10" fill="#C8B6E7" />
        <ellipse cx="393" cy="225" rx="59" ry="10" fill="#C8B6E7" />
        <g transform="translate(69 5) rotate(-10 100 130) scale(1.2)">
          <GameCharacter role="catcher" />
        </g>
        <g transform="translate(298 8) rotate(9 90 130) scale(1.2)">
          <GameCharacter role="runner" />
        </g>
        <g stroke="#241B35" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m281 40 9 18 20 3-15 14 4 20-18-9-18 9 4-20-15-14 20-3 9-18Z" fill="#FFD84D" />
          <path d="m473 40 4 11 12 4-12 4-4 12-4-12-11-4 11-4 4-11Z" fill="#FFF" />
          <path d="m77 133 4 11 12 4-12 4-4 12-4-12-11-4 11-4 4-11Z" fill="#FFD84D" />
          <path d="m467 152 29-7m-25 24 39-6M51 79l29 7m-27 9 20 5" />
          <path d="m254 124 23-5-8-11m8 11-6 12" />
          <path d="m523 88 5-7m-5 26 10 3M31 174l-6 6" />
        </g>
      </svg>
    </div>
  );
}
