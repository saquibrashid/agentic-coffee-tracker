import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges and deduplicates Tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('handles conditional values', () => {
    const isHidden = false as boolean;
    expect(cn('text-sm', isHidden && 'hidden', undefined, 'font-bold')).toBe('text-sm font-bold');
  });
});
