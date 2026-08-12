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
 * change it, and as little else on screen as possible.
 *
 * These tests pin three things a later refactor could quietly undo: that order,
 * that the editing tools stay folded away until asked for, and the way back
 * out.
 */

// The panels behind the disclosures each reach for services this page has no
// business booting to answer "what is above what".
vi.mock('./EnrichPanel', () => ({
  EnrichPanel: () => <p>enrich panel body</p>,
}));
vi.mock('./PhotoPanel', () => ({
  PhotoPanel: () => <p>photo panel body</p>,
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
    expect(await screen.findByText('6.5')).toBeInTheDocument();
    expect(screen.getByText(/2 ratings/)).toBeInTheDocument();
  });

  it('says so plainly when a coffee has never been rated', async () => {
    renderPage();
    expect(await screen.findByText('Not rated')).toBeInTheDocument();
  });

  it('puts the coffee before anything that changes it', async () => {
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    await screen.findByText('Holler Mtn.');
    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent)
      .filter((t): t is string => t !== null);

    // The whole point of the layout: reading comes before editing.
    expect(headings.indexOf('Holler Mtn.')).toBeLessThan(headings.indexOf('Ratings'));
    expect(headings.indexOf('Ratings')).toBeLessThan(headings.indexOf('Details from the web'));
    expect(headings.indexOf('Details from the web')).toBeLessThan(headings.indexOf('Photo'));
  });

  /*
   * The busyness complaint, as a test. Every one of these was permanently open
   * below the coffee, which is what made the page several screens long.
   */
  it('keeps the editing tools folded away until they are asked for', async () => {
    renderPage();

    await screen.findByText('Holler Mtn.');
    expect(screen.queryByText('enrich panel body')).not.toBeVisible();
    expect(screen.queryByText('photo panel body')).not.toBeVisible();
    expect(screen.queryByRole('form', { name: 'Add rating' })).not.toBeInTheDocument();
  });

  it('opens a folded panel when its heading is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Details from the web'));
    expect(screen.getByText('enrich panel body')).toBeVisible();
  });

  it('opens the add-rating form on request and closes it again', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add rating/i }));
    const form = screen.getByRole('form', { name: 'Add rating' });
    expect(form).toBeInTheDocument();

    await user.click(within(form).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('form', { name: 'Add rating' })).not.toBeInTheDocument();
  });

  it('keeps the rating history above the form that adds to it', async () => {
    const user = userEvent.setup();
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add rating/i }));
    const list = screen.getByRole('list');
    const form = screen.getByRole('form', { name: 'Add rating' });
    // The form is inserted above the list so the newly added rating appears
    // directly below it, which is the confirmation that it worked.
    expect(form.compareDocumentPosition(list)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /*
   * The library badges a coffee "Needs review". Every accepted web suggestion
   * raises that flag, and nothing outside the capture flow used to lower it, so
   * an enriched import carried the badge for good and its own page said nothing
   * about it. These pin both halves of the answer.
   */
  it('says what needs reviewing when the library badges the coffee', async () => {
    await db.beans.clear();
    await db.beans.add({ ...bean, needsReview: true, sourceUrl: 'https://example.test/coffee' });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: /check these details/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/read off a web page/i)).toBeInTheDocument();
  });

  it('stays quiet about review when the coffee is not flagged', async () => {
    renderPage();

    await screen.findByRole('heading', { name: bean.name });
    expect(screen.queryByRole('heading', { name: /check these details/i })).not.toBeInTheDocument();
  });

  it('lets the reader settle the flag, which nothing on this page could do', async () => {
    const user = userEvent.setup();
    await db.beans.clear();
    await db.beans.add({ ...bean, needsReview: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /looks right/i }));

    await waitFor(async () => {
      expect((await db.beans.get('bean-1'))?.needsReview).toBe(false);
    });
    // The prompt has been answered, so it stops taking up the page.
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: /check these details/i }),
      ).not.toBeInTheDocument();
    });
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

  it('keeps removing a coffee last, away from the details', async () => {
    renderPage();

    const remove = await screen.findByRole('button', { name: /remove coffee/i });
    const photo = screen.getByRole('heading', { name: 'Photo' });
    // A destructive action sat top-right of the title, one mis-tap from the
    // name of the coffee being read.
    expect(photo.compareDocumentPosition(remove)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /*
   * A coffee straight out of a bulk import knows only its name and roaster.
   * Four rows of em dashes is noise that looks like content, so the page says
   * what is true and points at the tool that fixes it.
   */
  it('does not print a row of dashes for a coffee it knows nothing about', async () => {
    // `exactOptionalPropertyTypes` forbids updating a field *to* undefined, so
    // the sparse bean is built without the key rather than by clearing it.
    const { roastLevel: _roastLevel, ...sparse } = bean;
    await db.beans.clear();
    await db.beans.add(sparse);
    renderPage();

    expect(await screen.findByText(/nothing else is known about this coffee/i)).toBeInTheDocument();
    expect(screen.queryByText('Roast')).not.toBeInTheDocument();
  });

  it('still lists every rating', async () => {
    await db.ratings.bulkAdd([makeRating('r1', 8), makeRating('r2', 5)]);
    renderPage();

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});
