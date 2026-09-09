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
  await db.pendingAiTasks.clear();
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

    const remove = await screen.findByRole('button', { name: /remove coffee/i });
    const ratings = screen.getByRole('heading', { name: 'Ratings' });
    expect(remove.compareDocumentPosition(ratings)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText(/manage this coffee/i)).toBeInTheDocument();
  });

  it('names the coffee and its dependent records before removal', async () => {
    const user = userEvent.setup();
    await db.ratings.add(makeRating('r1', 8));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /remove coffee/i }));

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

/**
 * Saving a coffee with gaps queues a web lookup, and until now nothing said so
 * — which is how someone ends up filling in by hand what was about to be
 * filled in for them, or leaving it blank without knowing the option existed.
 */
describe('BeanDetailPage pending lookup', () => {
  function queueTask(type: 'web-enrich' | 'studio-photo') {
    return db.pendingAiTasks.add({
      id: `task-${type}`,
      schemaVersion: 1,
      type,
      payload: { reason: 'single-add' },
      beanId: bean.id,
      attempts: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('says a lookup is already running for this coffee', async () => {
    await queueTask('web-enrich');
    renderPage();

    expect(await screen.findByText('Filling in what is missing')).toBeInTheDocument();
  });

  it('says nothing when no lookup is queued', async () => {
    renderPage();

    await screen.findByText('Holler Mtn.');
    expect(screen.queryByText('Filling in what is missing')).not.toBeInTheDocument();
  });

  // A studio re-shoot is queued against the same bean and is not a lookup.
  // Reporting it as one would describe work the user never asked about here.
  it('ignores queued work that is not a lookup', async () => {
    await queueTask('studio-photo');
    renderPage();

    await screen.findByText('Holler Mtn.');
    expect(screen.queryByText('Filling in what is missing')).not.toBeInTheDocument();
  });

  it('takes the notice away once the queue has finished the task', async () => {
    await queueTask('web-enrich');
    renderPage();
    await screen.findByText('Filling in what is missing');

    await db.pendingAiTasks.delete('task-web-enrich');

    await waitFor(() =>
      expect(screen.queryByText('Filling in what is missing')).not.toBeInTheDocument(),
    );
  });
});

/**
 * The only bean attribute this page lets the user change by hand.
 *
 * It exists because caffeine is assumed rather than read: a bag that does not
 * say "decaf" is recorded as caffeinated, so an unmarked decaf can only be
 * corrected here. A web lookup cannot do it — there is no evidence on the
 * product page for it to find.
 */
describe('BeanDetailPage caffeine control', () => {
  beforeEach(async () => {
    await db.outbox.clear();
  });

  it('shows the stored value', async () => {
    await db.beans.update('bean-1', { caffeine: 'decaf' });
    renderPage();

    const select = await screen.findByLabelText('Caffeine');
    expect(select).toHaveValue('decaf');
  });

  it('writes a correction the user makes', async () => {
    await db.beans.update('bean-1', { caffeine: 'caffeinated' });
    renderPage();

    const select = await screen.findByLabelText('Caffeine');
    await userEvent.selectOptions(select, 'decaf');

    await waitFor(async () => expect((await db.beans.get('bean-1'))?.caffeine).toBe('decaf'));
  });

  it('queues the correction for sync', async () => {
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText('Caffeine'), 'decaf');

    await waitFor(async () => {
      const queued = await db.outbox.toArray();
      expect(queued.some((row) => row.recordId === 'bean-1')).toBe(true);
    });
  });

  it('stays reachable on a coffee nothing else is known about', async () => {
    // The control used to sit inside the attribute grid, which was replaced
    // wholesale by a "nothing known yet" message -- putting the one fix for a
    // sparse decaf exactly out of reach.
    await db.beans.clear();
    await db.beans.add({
      id: 'bean-1',
      schemaVersion: 1,
      roaster: 'Unknown',
      name: 'Draft from photo',
      isArchived: false,
      needsReview: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as CoffeeBean);
    renderPage();

    expect(await screen.findByText(/Nothing else is known/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Caffeine')).toBeInTheDocument();
  });
});

/**
 * A coffee can have been bought in one place and documented in another.
 * Cometeer sells other roasters' beans flash-frozen, so enrichment finds the
 * roaster's page while the user bought the box -- and the page used to show
 * whichever of the two was written last.
 */
describe('BeanDetailPage source links', () => {
  it('shows both places when they differ', async () => {
    await db.beans.update('bean-1', {
      vendorUrl: 'https://cometeer.com/products/build-your-own-box',
      sourceUrl: 'https://counterculturecoffee.com/products/fast-forward-12oz-bag',
    });
    renderPage();

    expect(await screen.findByRole('link', { name: 'cometeer.com' })).toHaveAttribute(
      'href',
      'https://cometeer.com/products/build-your-own-box',
    );
    expect(screen.getByRole('link', { name: 'counterculturecoffee.com' })).toBeInTheDocument();
  });

  it('shows one link when the coffee was added from the same page it was read from', async () => {
    const url = 'https://counterculturecoffee.com/products/fast-forward-12oz-bag';
    await db.beans.update('bean-1', { vendorUrl: url, sourceUrl: url });
    renderPage();

    await screen.findByText('Holler Mtn.');
    expect(screen.getAllByRole('link', { name: 'counterculturecoffee.com' })).toHaveLength(1);
  });

  it('still shows the one link a coffee added before this field existed has', async () => {
    await db.beans.update('bean-1', {
      sourceUrl: 'https://counterculturecoffee.com/products/fast-forward-12oz-bag',
    });
    renderPage();

    expect(
      await screen.findByRole('link', { name: 'counterculturecoffee.com' }),
    ).toBeInTheDocument();
  });

  it('strips www so the host reads as the name of a place', async () => {
    await db.beans.update('bean-1', { sourceUrl: 'https://www.highwirecoffee.com/products/x' });
    renderPage();

    expect(await screen.findByRole('link', { name: 'highwirecoffee.com' })).toBeInTheDocument();
  });

  it('names the shop beside the roaster when one sold the coffee', async () => {
    await db.beans.update('bean-1', { vendor: 'Cometeer' });
    renderPage();

    // Identity, not a tasting attribute -- "via" because the roaster made it
    // and the shop only sold it.
    expect(await screen.findByText(/via Cometeer/)).toBeInTheDocument();
    expect(screen.getByText(/Stumptown Coffee Roasters/)).toBeInTheDocument();
  });

  it('says nothing about a shop for a coffee bought from its roaster', async () => {
    renderPage();

    await screen.findByText('Holler Mtn.');
    expect(screen.queryByText(/via /)).not.toBeInTheDocument();
  });

  it('shows no links when the coffee has no address, but still offers to take one', async () => {
    renderPage();

    await screen.findByText('Holler Mtn.');
    expect(screen.queryByText(/Where you bought it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Where the details came from/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add where you bought this/i })).toBeInTheDocument();
  });
});

/**
 * A coffee photographed off the shelf has no address at all.
 *
 * Only the link path has a URL to record. Photograph a Cometeer box and the app
 * reads the label, searches for the roaster and lands on Counter Culture's own
 * page -- right as provenance, and leaving nothing to say the coffee came in a
 * Cometeer box. That is not something capture can derive, so the user has to be
 * able to say it, and to correct it when a lookup found the wrong shop.
 */
describe('BeanDetailPage vendor address editing', () => {
  beforeEach(async () => {
    await db.outbox.clear();
  });

  it('records where a photographed coffee was bought', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add where you bought this/i }));
    await user.type(
      screen.getByLabelText('Where you bought it'),
      'https://cometeer.com/products/build-your-own-box',
    );
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(async () => {
      expect((await db.beans.get('bean-1'))?.vendorUrl).toBe(
        'https://cometeer.com/products/build-your-own-box',
      );
    });
    expect(await screen.findByRole('link', { name: 'cometeer.com' })).toBeInTheDocument();
  });

  it('queues the change for sync', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add where you bought this/i }));
    await user.type(screen.getByLabelText('Where you bought it'), 'https://cometeer.com/x');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(async () => {
      const queued = await db.outbox.toArray();
      expect(queued.some((row) => row.recordId === 'bean-1')).toBe(true);
    });
  });

  it('refuses something that is not a web address rather than storing it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add where you bought this/i }));
    await user.type(screen.getByLabelText('Where you bought it'), 'cometeer');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/full web address/i);
    expect((await db.beans.get('bean-1'))?.vendorUrl).toBeUndefined();
  });

  it('rejects a link the browser could not open', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add where you bought this/i }));
    // A parseable URL, but not one a link can point at.
    await user.type(screen.getByLabelText('Where you bought it'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect((await db.beans.get('bean-1'))?.vendorUrl).toBeUndefined();
  });

  it('removes the address when the box is emptied, rather than storing a blank', async () => {
    const user = userEvent.setup();
    await db.beans.update('bean-1', { vendorUrl: 'https://cometeer.com/x' });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /change where you bought this/i }));
    await user.clear(screen.getByLabelText('Where you bought it'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(async () => {
      const stored = await db.beans.get('bean-1');
      // Absent, not present-and-undefined: sync stores the whole payload, so a
      // key left behind would be copied to every other device as a value.
      expect(stored && 'vendorUrl' in stored).toBe(false);
    });
  });

  it('offers to change an address the coffee already has', async () => {
    const user = userEvent.setup();
    await db.beans.update('bean-1', { vendorUrl: 'https://cometeer.com/x' });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /change where you bought this/i }));
    expect(screen.getByLabelText('Where you bought it')).toHaveValue('https://cometeer.com/x');
  });

  it('leaves the coffee alone when the edit is cancelled', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add where you bought this/i }));
    await user.type(screen.getByLabelText('Where you bought it'), 'https://cometeer.com/x');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect((await db.beans.get('bean-1'))?.vendorUrl).toBeUndefined();
    expect(screen.queryByLabelText('Where you bought it')).not.toBeInTheDocument();
  });
});
