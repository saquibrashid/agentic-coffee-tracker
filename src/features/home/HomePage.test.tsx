import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import { HomePage } from './HomePage';

/**
 * A shelf of coffee is recognised by the bags on it long before anyone reads a
 * label, and the app already holds a thumbnail for most beans. These pin that
 * home shows it, and that a bean without one still takes up the same room —
 * a missing picture must not shunt its neighbours' titles out of line.
 */

function bean(id: string, name: string, extra: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Stumptown Coffee Roasters',
    name,
    roastLevel: 'medium',
    process: 'unknown',
    origins: [],
    tastingNotes: [],
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

beforeEach(async () => {
  await db.beans.clear();
});

describe('HomePage bean cards', () => {
  it('shows the bag photo it has stored', async () => {
    await db.beans.add(bean('b1', 'Holler Mtn.', { thumbnailDataUrl: 'data:image/webp;base64,x' }));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await screen.findByText('Holler Mtn.');
    const card = screen.getByText('Holler Mtn.').closest('a');
    const image = card!.querySelector('img');
    expect(image).toHaveAttribute('src', 'data:image/webp;base64,x');
    // Decorative: the name and roaster are already read out beside it.
    expect(image).toHaveAttribute('alt', '');
  });

  it('holds the space open for a coffee with no photo', async () => {
    await db.beans.add(bean('b2', 'Night Light Decaf'));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await screen.findByText('Night Light Decaf');
    const card = screen.getByText('Night Light Decaf').closest('a');
    expect(card!.querySelector('img')).toBeNull();
    expect(card!.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('still links each card to the coffee', async () => {
    await db.beans.add(bean('b3', 'El Jordan', { thumbnailDataUrl: 'data:image/webp;base64,y' }));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /El Jordan/ })).toHaveAttribute('href', '/beans/b3');
    });
  });
});
