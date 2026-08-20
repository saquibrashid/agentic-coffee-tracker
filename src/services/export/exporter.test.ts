import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import { loadSampleData } from '@/services/sample/sampleData';
import type { CoffeeBean, Rating } from '@/types';
import { exportCsv, exportJson } from './exporter';

function realBean(id: string, name: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'My Roaster',
    name,
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

/** Captures whatever the exporter hands to the browser to download. */
let captured: Blob[] = [];

beforeEach(async () => {
  await db.beans.clear();
  await db.ratings.clear();
  captured = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      captured.push(blob);
      return 'blob:stub';
    },
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function lastDownloadText(): Promise<string> {
  const blob = captured.at(-1);
  if (!blob) throw new Error('nothing was downloaded');
  return blob.text();
}

describe('export', () => {
  it('includes the coffees the user actually added', async () => {
    await db.beans.add(realBean('mine', 'My Real Coffee'));
    await db.ratings.add(realRating('mine-r', 'mine'));

    await exportJson();

    expect(await lastDownloadText()).toContain('My Real Coffee');
  });

  it('leaves sample coffees out of a JSON backup', async () => {
    // An export is a backup of what the user drank. Sample coffees live in the
    // same tables so Analytics can use them, so they have to be stripped here
    // or a restore would quietly resurrect coffees nobody ever had (#241).
    await db.beans.add(realBean('mine', 'My Real Coffee'));
    await loadSampleData();

    await exportJson();
    const text = await lastDownloadText();

    expect(text).toContain('My Real Coffee');
    expect(text).not.toContain('Sample Roasters');
    expect(text).not.toContain('"isSample"');
  });

  it('leaves sample coffees out of a CSV backup', async () => {
    await db.beans.add(realBean('mine', 'My Real Coffee'));
    await db.ratings.add(realRating('mine-r', 'mine'));
    await loadSampleData();

    await exportCsv();
    const text = await lastDownloadText();

    expect(text).toContain('My Real Coffee');
    expect(text).not.toContain('Sample Roasters');
  });

  it('exports nothing but headers when the only coffees are samples', async () => {
    await loadSampleData();

    await exportJson();
    const payload = JSON.parse(await lastDownloadText()) as {
      beans: unknown[];
      ratings: unknown[];
    };

    expect(payload.beans).toHaveLength(0);
    expect(payload.ratings).toHaveLength(0);
  });
});
