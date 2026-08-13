import 'fake-indexeddb/auto';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';
import { BeansLibraryPage } from './BeansLibraryPage';

function bean(id: string, name: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Storyville',
    name,
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(async () => {
  await Promise.all([db.beans.clear(), db.ratings.clear()]);
  await db.beans.bulkAdd([bean('a', 'Epilogue'), bean('b', 'Prologue')]);
});

describe('BeansLibraryPage management', () => {
  it('explains how to select and remove coffees', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BeansLibraryPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Manage' }));

    expect(screen.getByText(/select coffees to remove/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Select Epilogue'));
    expect(screen.getByRole('button', { name: /remove selected/i })).toBeEnabled();
    expect(
      within(screen.getByRole('list', { name: 'Beans' })).getAllByRole('checkbox'),
    ).toHaveLength(2);
  });
});
