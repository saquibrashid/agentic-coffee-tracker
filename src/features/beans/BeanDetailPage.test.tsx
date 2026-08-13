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

  /*
   * Everything the record can hold used to reach this page and stop: only
   * roast, origin, process and roast date were rendered, so tasting notes,
   * varietals, elevation, purchase date, bag size, price and the roaster's
   * own description were stored, enriched and synced but never shown.
   */
  it('shows every detail the coffee actually holds', async () => {
    await db.beans.clear();
    await db.beans.add({
      ...bean,
      origins: [{ country: 'Colombia', region: 'Huila' }],
      process: 'washed',
      varietals: ['Caturra', 'Colombia'],
      elevationMeters: { min: 1800, max: 2000 },
      tastingNotes: ['Dark chocolate', 'Walnut', 'Raisin'],
      roasterDescription: 'A syrupy cup with a long finish.',
      roastDate: '2026-06-01',
      purchaseDate: '2026-06-04',
      bagSizeGrams: 300,
      pricePaid: { amount: 21.5, currency: 'USD' },
    });
    renderPage();

    expect(await screen.findByText('Colombia (Huila)')).toBeInTheDocument();
    expect(screen.getByText('Caturra, Colombia')).toBeInTheDocument();
    expect(screen.getByText('1,800–2,000 m')).toBeInTheDocument();
    expect(screen.getByText('Dark chocolate')).toBeInTheDocument();
    expect(screen.getByText('A syrupy cup with a long finish.')).toBeInTheDocument();
    expect(screen.getByText('300 g')).toBeInTheDocument();
    expect(screen.getByText('$21.50')).toBeInTheDocument();
    // A bare date is calendar text; parsing it as an instant shows the day
    // before for anyone west of UTC.
    expect(screen.getByText('Jun 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Jun 4, 2026')).toBeInTheDocument();
  });

  it('still leaves out the fields the coffee has nothing for', async () => {
    await db.beans.clear();
    await db.beans.add({ ...bean, tastingNotes: ['Cocoa'] });
    renderPage();

    expect(await screen.findByText('Cocoa')).toBeInTheDocument();
    expect(screen.queryByText('Price paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Elevation')).not.toBeInTheDocument();
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

  it('makes coffee management visible in the primary coffee card', async () => {
    renderPage();

    const remove = await screen.findByRole('button', { name: /^remove$/i });
    const ratings = screen.getByRole('heading', { name: 'Ratings' });
    expect(remove.compareDocumentPosition(ratings)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/manage this coffee/i)).toBeInTheDocument();
  });

  it('names the coffee and its dependent records before removal', async () => {
    const user = userEvent.setup();
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^remove$/i }));

    expect(
      await screen.findByRole('heading', { name: `Remove ${bean.name}?`, hidden: true }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 coffee, 1 rating/i)).toBeInTheDocument();
  });

  it('adds a rating with a historical date', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add rating/i }));
    const form = screen.getByRole('form', { name: 'Add rating' });
    const date = within(form).getByLabelText(/date rated/i);
    await user.clear(date);
    await user.type(date, '2020-05-04');
    await user.click(within(form).getByRole('button', { name: /add rating/i }));

    await waitFor(async () => {
      const stored = await db.ratings.toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.ratedAt).toBe('2020-05-04T12:00:00.000Z');
    });
    expect(await screen.findByText(/May 4, 2020/i)).toBeInTheDocument();
  });

  it('edits a rating date without changing its creation date', async () => {
    const user = userEvent.setup();
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /edit rating/i }));
    const form = screen.getByRole('form', { name: 'Edit rating' });
    const date = within(form).getByLabelText(/date rated/i);
    await user.clear(date);
    await user.type(date, '2020-05-04');
    await user.click(within(form).getByRole('button', { name: /save rating/i }));

    await waitFor(async () => {
      const stored = await db.ratings.get('r1');
      expect(stored?.ratedAt).toBe('2020-05-04T08:00:00.000Z');
      expect(stored?.createdAt).toBe('2026-07-01T08:00:00.000Z');
    });
  });

  it('orders rating history by the corrected rating date', async () => {
    await db.ratings.bulkAdd([
      makeRating('older', 7),
      {
        ...makeRating('newer', 9),
        ratedAt: '2026-08-01T08:00:00.000Z',
      },
    ]);
    renderPage();

    const items = within(await screen.findByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Aug 1, 2026');
    expect(items[1]).toHaveTextContent('Jul 1, 2026');
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
