import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, Rating } from '@/types';
import type * as EnrichModule from '@/services/enrich';

const mocks = vi.hoisted(() => ({
  extractBeanFromPhoto: vi.fn(),
  enrichFromUrl: vi.fn(),
}));

vi.mock('@/services/ai/pipeline', () => ({
  extractBeanFromPhoto: mocks.extractBeanFromPhoto,
  PipelineUnavailableError: class PipelineUnavailableError extends Error {},
}));

vi.mock('@/services/enrich', async (importOriginal) => {
  const actual = await importOriginal<typeof EnrichModule>();
  return { ...actual, enrichFromUrl: mocks.enrichFromUrl };
});

vi.mock('@/services/image/imagePipeline', () => ({
  resizeDataUrl: vi.fn(async (dataUrl: string) => ({
    dataUrl,
    width: 100,
    height: 100,
    byteSize: 100,
  })),
  dataUrlToBlob: vi.fn(() => new Blob(['coffee'], { type: 'image/jpeg' })),
}));

const { PredictPage } = await import('./PredictPage');

function bean(id: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Storyville',
    name: id,
    origins: [{ country: 'Colombia' }],
    roastLevel: 'medium',
    tastingNotes: ['chocolate'],
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function rating(index: number): Rating {
  return {
    id: `rating-${index}`,
    schemaVersion: 2,
    beanId: `bean-${index}`,
    score: 8,
    brewType: 'drip',
    ratedAt: `2026-01-0${index + 1}T12:00:00.000Z`,
    createdAt: `2026-01-0${index + 1}T12:00:00.000Z`,
    updatedAt: `2026-01-0${index + 1}T12:00:00.000Z`,
  };
}

const parsed = {
  roaster: 'Storyville',
  name: 'Epilogue',
  origins: [{ country: 'Colombia' }],
  process: 'washed' as const,
  roastLevel: 'medium' as const,
  tastingNotes: ['chocolate'],
  varietals: [],
};

beforeEach(async () => {
  await Promise.all([db.beans.clear(), db.ratings.clear()]);
  await db.beans.bulkAdd([bean('bean-0'), bean('bean-1'), bean('bean-2')]);
  await db.ratings.bulkAdd([rating(0), rating(1), rating(2)]);
  mocks.extractBeanFromPhoto.mockReset();
  mocks.enrichFromUrl.mockReset();
});

describe('PredictPage check sessions', () => {
  it('shows prominent progress and keeps the selected image in the review section', async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.extractBeanFromPhoto.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<PredictPage />);

    const input = await screen.findByLabelText(/photo of the bag/i);
    await user.upload(input, new File(['image'], 'epilogue.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByText(/working on your coffee/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /selected coffee bag: epilogue.jpg/i })).toBeVisible();

    finish?.({
      parsed,
      rawText: 'Storyville Epilogue',
      model: 'test',
      needsReview: false,
      usedMock: false,
    });

    expect(await screen.findByDisplayValue('Storyville')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /selected coffee bag: epilogue.jpg/i })).toBeVisible();
  });

  it('clears an old verdict as soon as a second photo starts and keeps new context on failure', async () => {
    mocks.extractBeanFromPhoto
      .mockResolvedValueOnce({
        parsed,
        rawText: 'Storyville Epilogue',
        model: 'test',
        needsReview: false,
        usedMock: false,
      })
      .mockRejectedValueOnce(new Error('Could not read second photo.'));
    const user = userEvent.setup();
    render(<PredictPage />);

    const input = await screen.findByLabelText(/photo of the bag/i);
    await user.upload(input, new File(['first'], 'first.jpg', { type: 'image/jpeg' }));
    await user.click(await screen.findByRole('button', { name: /will i like it/i }));
    expect(screen.getByTestId('prediction')).toBeInTheDocument();

    await user.upload(input, new File(['second'], 'second.jpg', { type: 'image/jpeg' }));

    expect(screen.queryByTestId('prediction')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read second photo.');
    expect(screen.getByRole('img', { name: /selected coffee bag: second.jpg/i })).toBeVisible();
    expect(screen.queryByDisplayValue('Storyville')).not.toBeInTheDocument();
  });

  it('identifies a URL source and offers an explicit next-check action', async () => {
    mocks.enrichFromUrl.mockResolvedValue({
      parsed,
      rawText: 'Storyville Epilogue',
      sourceUrl: 'https://storyville.com/products/epilogue',
      model: 'test',
    });
    const user = userEvent.setup();
    render(<PredictPage />);

    const url = await screen.findByLabelText(/link to the coffee/i);
    await user.type(url, 'https://storyville.com/products/epilogue');
    await user.click(screen.getByRole('button', { name: 'Read' }));

    expect(await screen.findByText('storyville.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /will i like it/i }));
    await user.click(screen.getByRole('button', { name: /check another coffee/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('prediction')).not.toBeInTheDocument();
      expect(screen.queryByText('storyville.com')).not.toBeInTheDocument();
    });
    expect(url).toHaveValue('');
  });

  it('ignores a late response after the user starts a newer check', async () => {
    let finishFirst: ((value: unknown) => void) | undefined;
    mocks.enrichFromUrl
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        parsed: { ...parsed, roaster: 'Onyx', name: 'Geometry' },
        rawText: 'Onyx Geometry',
        sourceUrl: 'https://onyxcoffeelab.com/products/geometry',
        model: 'test',
      });
    const user = userEvent.setup();
    render(<PredictPage />);

    const url = await screen.findByLabelText(/link to the coffee/i);
    await user.type(url, 'https://storyville.com/products/epilogue');
    await user.click(screen.getByRole('button', { name: 'Read' }));
    await user.click(await screen.findByRole('button', { name: /cancel and start over/i }));

    await user.type(url, 'https://onyxcoffeelab.com/products/geometry');
    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(await screen.findByDisplayValue('Onyx')).toBeInTheDocument();

    finishFirst?.({
      parsed,
      rawText: 'Storyville Epilogue',
      sourceUrl: 'https://storyville.com/products/epilogue',
      model: 'test',
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Onyx')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Storyville')).not.toBeInTheDocument();
    });
  });
});
