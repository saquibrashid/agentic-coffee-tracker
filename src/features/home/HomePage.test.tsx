import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, PhotoBlob, Rating } from '@/types';

import { HomePage } from './HomePage';

const createObjectURL = vi.fn(() => 'blob:featured-full-size');
const revokeObjectURL = vi.fn();

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

function rating(id: string, beanId: string, score: number, ratedAt: string): Rating {
  return {
    id,
    schemaVersion: 2,
    beanId,
    score,
    brewType: 'drip',
    ratedAt,
    createdAt: ratedAt,
    updatedAt: ratedAt,
  };
}

function photo(id: string): PhotoBlob {
  return {
    id,
    schemaVersion: 1,
    kind: 'bag',
    mimeType: 'image/webp',
    blob: new Blob(['full-size'], { type: 'image/webp' }),
    widthPx: 1600,
    heightPx: 1200,
    byteSize: 9,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  globalThis.URL.createObjectURL = createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  await Promise.all([db.beans.clear(), db.ratings.clear(), db.photos.clear()]);
});

describe('HomePage bean cards', () => {
  it('shows the bag photo it has stored', async () => {
    await db.beans.add(bean('b1', 'Holler Mtn.', { thumbnailDataUrl: 'data:image/webp;base64,x' }));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const recent = await screen.findByRole('region', { name: /recent coffees/i });
    const card = within(recent).getByText('Holler Mtn.').closest('a');
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

    const recent = await screen.findByRole('region', { name: /recent coffees/i });
    const card = within(recent).getByText('Night Light Decaf').closest('a');
    expect(card!.querySelector('img')).toBeNull();
    expect(card!.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('sharpens the featured coffee with its full stored photo only', async () => {
    await db.photos.add(photo('p1'));
    await db.beans.add(
      bean('b-photo', 'Hair Bender', {
        photoId: 'p1',
        thumbnailDataUrl: 'data:image/webp;base64,thumb',
      }),
    );

    const { unmount } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const featured = await screen.findByRole('region', { name: /your coffee right now/i });
    const featuredImage = featured.querySelector('img');
    expect(featuredImage).toHaveAttribute('src', 'data:image/webp;base64,thumb');
    await waitFor(() => expect(featuredImage).toHaveAttribute('src', 'blob:featured-full-size'));

    const recent = screen.getByRole('region', { name: /recent coffees/i });
    expect(recent.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,thumb');
    expect(createObjectURL).toHaveBeenCalledOnce();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:featured-full-size');
  });

  it('keeps the featured thumbnail when its stored photo is missing', async () => {
    await db.beans.add(
      bean('b-missing-photo', 'Night Light', {
        photoId: 'missing',
        thumbnailDataUrl: 'data:image/webp;base64,thumb',
      }),
    );

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const featured = await screen.findByRole('region', { name: /your coffee right now/i });
    await waitFor(() =>
      expect(featured.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,thumb'),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('still links each card to the coffee', async () => {
    await db.beans.add(bean('b3', 'El Jordan', { thumbnailDataUrl: 'data:image/webp;base64,y' }));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const recent = screen.getByRole('region', { name: /recent coffees/i });
      expect(within(recent).getByRole('link', { name: /El Jordan/ })).toHaveAttribute(
        'href',
        '/beans/b3',
      );
    });
  });

  it('welcomes returning users before showing recent coffees', async () => {
    await db.beans.add(bean('b4', 'Hair Bender'));

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const welcome = await screen.findByRole('heading', { name: /ready for the next great cup/i });
    const recent = screen.getByRole('heading', { name: /recent coffees/i });
    expect(welcome.compareDocumentPosition(recent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('link', { name: /add a coffee/i })).toHaveAttribute('href', '/add');
    expect(screen.getByRole('link', { name: /check a coffee/i })).toHaveAttribute(
      'href',
      '/predict',
    );
  });

  it('features a recent rated coffee and useful history highlights', async () => {
    await db.beans.bulkAdd([bean('b5', 'Geometry'), bean('b6', 'Founders Blend')]);
    await db.ratings.bulkAdd([
      rating('r1', 'b5', 9, '2026-08-10T12:00:00.000Z'),
      rating('r2', 'b5', 8, '2026-08-11T12:00:00.000Z'),
      rating('r3', 'b6', 6, '2026-08-09T12:00:00.000Z'),
    ]);

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Your latest rating:/i)).toHaveTextContent('8/10');
    expect(screen.getByText('Ratings logged').parentElement?.parentElement).toHaveTextContent('3');
    expect(screen.getByText('Average score').parentElement?.parentElement).toHaveTextContent('7.7');
    expect(screen.getByText('Current favorite').parentElement?.parentElement).toHaveTextContent(
      'Geometry',
    );
    expect(screen.getByRole('link', { name: /current favorite/i })).toHaveAttribute(
      'href',
      '/for-you',
    );
  });
});
