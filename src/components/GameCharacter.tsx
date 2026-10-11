interface GameCharacterProps {
  role: 'runner' | 'catcher';
  className?: string;
  variant?: number;
  celebratory?: boolean;
}

/** Original, decorative team mascots. The silhouette identifies the team, too. */
export function GameCharacter({ role, className = '', variant = 0, celebratory = false }: GameCharacterProps) {
  const runner = role === 'runner';
  const ink = '#241B35';
  const color = runner ? '#2563EB' : '#DC2626';
  const expression = Math.abs(variant) % 3;

  return (
    <svg
      className={`game-character ${role}-character ${className}`}
      viewBox="0 0 160 180"
      width="160"
      height="180"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M63 127 54 151 37 157M98 128l15 17 17-4" />
        <path d="m35 152 19 3 2 12H27c-7 0-6-9 8-15Z" fill="#FFF" />
        <path d="m128 136 5 13 15-4c7-2 7-9 1-12l-6-2-15 5Z" fill="#FFF" />
        <path
          d={celebratory ? 'M42 87 22 63 18 40M118 84l20-25 5-22' : 'M41 91 22 110 12 100M117 77l20-18 11 8'}
        />
        <circle cx={celebratory ? 17 : 12} cy={celebratory ? 35 : 98} r="8" fill={color} />
        <circle cx={celebratory ? 145 : 148} cy={celebratory ? 32 : 67} r="8" fill={color} />
        {runner ? (
          <path d="M34 81c-1-31 20-53 46-53 31 0 49 25 46 56l-3 19c-2 23-21 37-43 35-24-2-40-12-44-34l-2-23Z" fill={color} />
        ) : (
          <path d="m36 53 19-23 27 8 27-8 19 23-6 67-23 17H60l-24-17V53Z" fill={color} />
        )}
        {runner ? (
          <path d="M42 53c18-9 49-10 76-1" stroke="#A8C5FF" strokeWidth="7" />
        ) : (
          <path d="m45 51 12-11 23 8 23-8 12 11" stroke="#FF9F91" strokeWidth="5" />
        )}
        <ellipse cx="67" cy="73" rx="12" ry="17" fill="#FFF" strokeWidth="3" />
        <ellipse cx="97" cy="73" rx="12" ry="17" fill="#FFF" strokeWidth="3" />
        {expression === 2 ? (
          <path d="m62 75 5-4 5 4m20 0 5-4 5 4" strokeWidth="4" />
        ) : (
          <>
            <ellipse cx={expression === 1 ? 65 : 71} cy="75" rx="4" ry="6" fill={ink} stroke="none" />
            <ellipse cx={expression === 1 ? 95 : 101} cy="75" rx="4" ry="6" fill={ink} stroke="none" />
          </>
        )}
        <path d={celebratory ? 'M68 99h30c-1 19-27 20-30 0Z' : 'M70 99c8 9 18 8 26-1'} fill={celebratory ? '#FFF' : 'none'} strokeWidth="4" />
        <path d="M49 95h5m57 0h5" stroke={runner ? '#A8C5FF' : '#FFAC9F'} strokeWidth="5" />
        {runner ? (
          <path d="m80 112-7 12h8l-2 9 12-15h-9l3-6Z" fill="#FFF2A9" stroke="none" />
        ) : (
          <circle cx="82" cy="122" r="7" fill="#FFF2A9" strokeWidth="2" />
        )}
      </g>
    </svg>
  );
}
