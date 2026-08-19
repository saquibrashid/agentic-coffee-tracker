import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoffeeBean } from '@/types';
import { pasteInto } from '@/test/interactions';

/**
 * Automatic lookup finds a coffee by guessing where its roaster sells, so it
 * can only ever reach roasters it manages to place. A roaster who is not on a
 * platform it understands is invisible to it, and no amount of improving the
 * guess changes that.
 *
 * Pasting the address is the way out of that, and the only part of enrichment
 * guaranteed to work for every coffee — so these tests cover it as the escape
 * hatch it is, not as a convenience.
 */

const enrichFromUrl = vi.hoisted(() => vi.fn());
const enrichFromText = vi.hoisted(() => vi.fn());
const enrichFromPdf = vi.hoisted(() => vi.fn());
const findCandidates = vi.hoisted(() => vi.fn());

vi.mock('@/services/enrich', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enrichFromUrl,
  enrichFromText,
  enrichFromPdf,
  findCandidates,
}));

vi.mock('@/services/enrich/photo', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  preparePhotoFromUrl: vi.fn().mockResolvedValue(null),
}));

const { EnrichPanel } = await import('./EnrichPanel');

const bean: CoffeeBean = {
  id: 'bean-1',
  schemaVersion: 1,
  roaster: 'High Wire Coffee Roasters',
  name: 'After Hours',
  roastLevel: 'unknown',
  process: 'unknown',
  origins: [],
  tastingNotes: [],
  source: 'manual',
  isArchived: false,
  needsReview: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A parse with every list present, as the API contract guarantees. */
const emptyParse = {
  roaster: null,
  name: null,
  origins: [],
  process: null,
  roastLevel: null,
  tastingNotes: [],
  roastDate: null,
  varietals: [],
  elevationMeters: null,
  roasterDescription: null,
  confidence: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();
  findCandidates.mockResolvedValue([]);
  enrichFromUrl.mockResolvedValue({
    parsed: { roastLevel: 'medium' },
    rawText: 'After Hours decaf',
    sourceUrl: 'https://www.highwirecoffee.com/products/after-hours-decaf-310g-bag',
    model: 'test',
  });
  enrichFromText.mockResolvedValue({
    parsed: {
      ...emptyParse,
      roastLevel: 'medium',
      tastingNotes: ['cocoa', 'citrus'],
    },
    rawText: 'After Hours decaf',
    model: 'test',
  });
  enrichFromPdf.mockResolvedValue({
    parsed: { ...emptyParse, roastLevel: 'dark' },
    rawText: 'After Hours decaf',
    model: 'test',
  });
});

describe('EnrichPanel manual URL', () => {
  it('reads a pasted page without searching first', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await pasteInto(
      user,
      screen.getByLabelText(/paste the product page address/i),
      'https://www.highwirecoffee.com/products/after-hours-decaf-310g-bag',
    );
    await user.click(screen.getByRole('button', { name: /read page/i }));

    await waitFor(() => expect(enrichFromUrl).toHaveBeenCalled());
    expect(enrichFromUrl).toHaveBeenCalledWith(
      'https://www.highwirecoffee.com/products/after-hours-decaf-310g-bag',
    );
    expect(findCandidates).not.toHaveBeenCalled();
  });

  it('offers the paste as the way out when the search finds nothing', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await user.click(screen.getByRole('button', { name: /find details on the web/i }));
    await screen.findByText(/no results for this coffee/i);

    // Still reachable, so a failed search is a detour rather than a dead end.
    expect(screen.getByLabelText(/paste the product page address/i)).toBeInTheDocument();
  });

  it('says so instead of spending a request on a bad paste', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await pasteInto(user, screen.getByLabelText(/paste the product page address/i), 'after hours');
    await user.click(screen.getByRole('button', { name: /read page/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like a web address/i);
    expect(enrichFromUrl).not.toHaveBeenCalled();
  });

  it('returns to where it started when a pasted page cannot be read', async () => {
    enrichFromUrl.mockRejectedValue(new Error('That page had no readable text.'));
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await pasteInto(
      user,
      screen.getByLabelText(/paste the product page address/i),
      'example.com/x',
    );
    await user.click(screen.getByRole('button', { name: /read page/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no readable text/i);
    // Not stranded in a phase it never came from.
    expect(screen.getByRole('button', { name: /find details on the web/i })).toBeInTheDocument();
  });
});

/**
 * The paste/PDF route exists for coffees with no page at all — the ones a
 * better search could never reach. Its whole value is that it lands in the same
 * review step as a scraped page, so that is what these assert.
 */
describe('EnrichPanel details without a page', () => {
  async function openPaste(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /paste details/i }));
    return screen.getByLabelText(/paste anything describing this coffee/i);
  }

  it('parses pasted details and reviews them like a page', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await pasteInto(
      user,
      await openPaste(user),
      'Washed Ethiopia, medium roast, citrus and cocoa.',
    );
    await user.click(screen.getByRole('button', { name: /read details/i }));

    await waitFor(() => expect(enrichFromText).toHaveBeenCalled());
    expect(await screen.findByLabelText(/proposed changes/i)).toBeInTheDocument();
    expect(enrichFromUrl).not.toHaveBeenCalled();
  });

  it('says the details came from the user, not from a made-up address', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await pasteInto(
      user,
      await openPaste(user),
      'Washed Ethiopia, medium roast, citrus and cocoa.',
    );
    await user.click(screen.getByRole('button', { name: /read details/i }));

    expect(await screen.findByText(/from the details you supplied/i)).toBeInTheDocument();
  });

  it('reads an uploaded PDF into the same review', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    const file = new File(['%PDF-1.7'], 'coffee.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/upload a pdf/i), file);

    await waitFor(() => expect(enrichFromPdf).toHaveBeenCalled());
    expect(await screen.findByLabelText(/proposed changes/i)).toBeInTheDocument();
  });

  it('returns to where it started when a PDF cannot be read', async () => {
    enrichFromPdf.mockRejectedValue(new Error('That file could not be read as a PDF.'));
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    const file = new File(['not-a-pdf'], 'coffee.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/upload a pdf/i), file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read as a pdf/i);
    expect(screen.getByRole('button', { name: /find details on the web/i })).toBeInTheDocument();
  });
});
