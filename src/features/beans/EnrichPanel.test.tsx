import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoffeeBean } from '@/types';

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
const findCandidates = vi.hoisted(() => vi.fn());

vi.mock('@/services/enrich', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enrichFromUrl,
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

beforeEach(() => {
  vi.clearAllMocks();
  findCandidates.mockResolvedValue([]);
  enrichFromUrl.mockResolvedValue({
    parsed: { roastLevel: 'medium' },
    rawText: 'After Hours decaf',
    sourceUrl: 'https://www.highwirecoffee.com/products/after-hours-decaf-310g-bag',
    model: 'test',
  });
});

describe('EnrichPanel manual URL', () => {
  it('reads a pasted page without searching first', async () => {
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await user.type(
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

    await user.type(screen.getByLabelText(/paste the product page address/i), 'after hours');
    await user.click(screen.getByRole('button', { name: /read page/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like a web address/i);
    expect(enrichFromUrl).not.toHaveBeenCalled();
  });

  it('returns to where it started when a pasted page cannot be read', async () => {
    enrichFromUrl.mockRejectedValue(new Error('That page had no readable text.'));
    const user = userEvent.setup();
    render(<EnrichPanel bean={bean} />);

    await user.type(screen.getByLabelText(/paste the product page address/i), 'example.com/x');
    await user.click(screen.getByRole('button', { name: /read page/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no readable text/i);
    // Not stranded in a phase it never came from.
    expect(screen.getByRole('button', { name: /find details on the web/i })).toBeInTheDocument();
  });
});
