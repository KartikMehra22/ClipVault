import type { FC, ReactNode } from 'react';

export interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'warning' | 'subtle' | 'neutral';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  className?: string;
}

export const Badge: FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  icon,
  className = '',
}) => {
  return (
    <span className={`clip-badge clip-badge-${variant} clip-badge-${size} ${className}`.trim()}>
      {icon && <span className="clip-badge-icon">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
