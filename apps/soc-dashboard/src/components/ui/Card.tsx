import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a subtle colored glow to the card border/shadow. */
  glow?: 'purple' | 'pink' | 'red' | 'orange' | 'blue' | 'green' | 'none';
}

const GLOW: Record<NonNullable<CardProps['glow']>, string> = {
  purple: 'hover:shadow-glow',
  pink: 'hover:shadow-glow-pink',
  red: 'shadow-glow-red',
  orange: 'shadow-glow-orange',
  blue: 'shadow-glow-blue',
  green: 'shadow-glow-green',
  none: '',
};

export function Card({ className, glow = 'none', ...props }: CardProps) {
  return (
    <div
      className={clsx('glass-card p-5 transition-shadow duration-300', GLOW[glow], className)}
      {...props}
    />
  );
}
