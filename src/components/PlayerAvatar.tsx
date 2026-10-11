interface PlayerAvatarProps {
  name: string;
  role?: 'runner' | 'catcher';
  small?: boolean;
}

export function playerInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export function PlayerAvatar({ name, role, small = false }: PlayerAvatarProps) {
  return (
    <span className={`player-avatar ${role ?? 'neutral'}${small ? ' small' : ''}`} aria-hidden="true">
      {playerInitials(name)}
    </span>
  );
}
