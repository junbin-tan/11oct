import { GameCharacter } from './GameCharacter';

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
  const variant = [...name].reduce((value, character) => value + character.charCodeAt(0), 0);

  return (
    <span className={`player-avatar ${role ?? 'neutral'}${small ? ' small' : ''}`} aria-hidden="true">
      <GameCharacter role={role ?? 'runner'} variant={variant} className="avatar-character" />
      <span className="avatar-initials">{playerInitials(name)}</span>
    </span>
  );
}
