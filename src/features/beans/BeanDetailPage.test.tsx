import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, Rating } from '@/types';

/**
 * The page is read far more often than it is edited, so what it owes the reader
 * is the coffee itself — name, score, attributes — before any of the forms that
 * change it. These tests pin that order, and the way back out, because both are
 * the kind of thing a later refactor quietly undoes.
 */

// The panels below the fold each reach for services this page has no business
// booting to answer "what is above what".
vi.mock('./EnrichPanel', () => ({
  EnrichPanel: () => <section>Web enrichment</section>,
}));
vi.mock('./PhotoPanel', () => ({
  PhotoPanel: () => <section>Photo</section>,
}));

const { BeanDetailPage } = await import('./BeanDetailPage');

const bean: CoffeeBean = {
  id: 'bean-1',
  schemaVersion: 1,
  roaster: 'Stumptown Coffee Roasters',
  name: 'Holler Mtn.',
  roastLevel: 'medium',
  process: 'unknown',
  origins: [],
  tastingNotes: [],
  source: 'manual',
  isArchived: false,
  needsReview: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeRating(id: string, score: number): Rating {
  return {
    id,
    schemaVersion: 2,
    beanId: bean.id,
    score,
    brewType: 'latte',
    ratedAt: '2026-07-01T08:00:00.000Z',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
  };
}

function renderPage(initialEntries: string[] = ['/beans/bean-1']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/beans" element={<p>All coffees page</p>} />
        <Route path="/beans/:beanId" element={<BeanDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.beans.clear();
  await db.ratings.clear();
  await db.beans.add(bean);
});

describe('BeanDetailPage', () => {
  it('shows the score beside the name, not buried under the forms', async () => {
    await db.ratings.bulkAdd([makeRating('r1', 8), makeRating('r2', 5)]);
    renderPage();

    // 8 and 5 average to 6.5, which is a legal half-step and so shown as-is.
    expect(await screen.findByText('6.5/10')).toBeInTheDocument();
    expect(screen.getByText(/2 ratings/)).toBeInTheDocument();
  });

  it('says so plainly when a coffee has never been rated', async () => {
    renderPage();
    expect(await screen.findByText('Not rated yet')).toBeInTheDocument();
  });

  it('puts the details before anything that changes the coffee', async () => {
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    await screen.findByText('Attributes');
    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent)
      .filter((t): t is string => t !== null);

    const attributes = headings.indexOf('Attributes');
    const ratings = headings.indexOf('Ratings');
    const changes = headings.indexOf('Make changes');

    expect(attributes).toBeLessThan(ratings);
    // The whole point of the reorder: reading comes before editing.
    expect(ratings).toBeLessThan(changes);
  });

  it('keeps the rating history above the form that adds to it', async () => {
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    const list = await screen.findByRole('list');
    const addHeading = screen.getByRole('heading', { name: 'Add a rating' });
    expect(list.compareDocumentPosition(addHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('offers a way back, which used to mean going Home', async () => {
    renderPage();
    // Opened directly — there is no history to go back through, so the link has
    // to name somewhere real rather than doing nothing.
    expect(await screen.findByRole('link', { name: /all coffees/i })).toBeInTheDocument();
  });

  it('returns to where the reader came from when there is history', async () => {
    const user = userEvent.setup();
    renderPage(['/beans', '/beans/bean-1']);

    await user.click(await screen.findByRole('button', { name: /^back$/i }));

    await waitFor(() => {
      expect(screen.getByText('All coffees page')).toBeInTheDocument();
    });
  });

  it('keeps removing a coffee at the bottom, away from the details', async () => {
    renderPage();

    const remove = await screen.findByRole('button', { name: /remove coffee/i });
    const changes = screen.getByRole('heading', { name: 'Make changes' });
    // A destructive action sat top-right of the title, one mis-tap from the
    // name of the coffee being read.
    expect(changes.compareDocumentPosition(remove)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('still lists every rating', async () => {
    await db.ratings.bulkAdd([makeRating('r1', 8), makeRating('r2', 5)]);
    renderPage();

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});
