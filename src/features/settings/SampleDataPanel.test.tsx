import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import { hasSampleData } from '@/services/sample/sampleData';
import type { CoffeeBean, Rating } from '@/types';
import { SampleDataPanel } from './SampleDataPanel';

/**
 * The service tests prove the samples are contained; this proves the wiring —
 * that the card reflects what is actually in the database rather than its own
 * idea of it, and that the offer flips to a way out once they are loaded.
 */
function realBean(id: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'My Roaster',
    name: 'My Coffee',
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

function realRating(id: string, beanId: string): Rating {
  return {
    id,
    schemaVersion: 2,
    beanId,
    score: 8,
    brewType: 'latte',
    ratedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

describe('SampleDataPanel', () => {
  beforeEach(async () => {
    await db.beans.clear();
    await db.ratings.clear();
    await db.outbox.clear();
  });

  it('offers to load samples when there are none', async () => {
    render(<SampleDataPanel />);

    expect(await screen.findByRole('button', { name: 'Load sample coffees' })).toBeInTheDocument();
  });

  it('loads them and then offers to take them away again', async () => {
    const user = userEvent.setup();
    render(<SampleDataPanel />);

    await user.click(await screen.findByRole('button', { name: 'Load sample coffees' }));

    expect(
      await screen.findByRole('button', { name: 'Remove sample coffees' }),
    ).toBeInTheDocument();
    expect(await hasSampleData()).toBe(true);
  });

  it('removes them again on request', async () => {
    const user = userEvent.setup();
    render(<SampleDataPanel />);

    await user.click(await screen.findByRole('button', { name: 'Load sample coffees' }));
    await user.click(await screen.findByRole('button', { name: 'Remove sample coffees' }));

    await waitFor(async () => expect(await hasSampleData()).toBe(false));
    expect(await screen.findByRole('button', { name: 'Load sample coffees' })).toBeInTheDocument();
  });

  it('nudges toward removal once the user has history of their own', async () => {
    const user = userEvent.setup();
    await db.beans.add(realBean('mine'));
    await db.ratings.add(realRating('mine-r', 'mine'));
    render(<SampleDataPanel />);

    await user.click(await screen.findByRole('button', { name: 'Load sample coffees' }));

    // Made-up coffees stop being scaffolding and start being noise in the
    // user's own averages the moment there are real ones to average.
    expect(await screen.findByText(/Removing the samples will make/i)).toBeInTheDocument();
    expect(screen.getByText(/rated 1 coffee of your own/i)).toBeInTheDocument();
  });

  it('says nothing about removal while the library is only samples', async () => {
    const user = userEvent.setup();
    render(<SampleDataPanel />);

    await user.click(await screen.findByRole('button', { name: 'Load sample coffees' }));
    await screen.findByRole('button', { name: 'Remove sample coffees' });

    expect(screen.queryByText(/Removing the samples will make/i)).not.toBeInTheDocument();
  });
});
