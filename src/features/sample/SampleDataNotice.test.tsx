import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import { loadSampleData, removeSampleData } from '@/services/sample/sampleData';
import { SampleDataNotice } from './SampleDataNotice';

/**
 * The notice exists to stop invented numbers being read as the user's own, so
 * the tests that matter are: does it appear exactly when the numbers are
 * contaminated, and does it disappear the moment they are not.
 */
function renderNotice() {
  return render(
    <MemoryRouter>
      <SampleDataNotice />
    </MemoryRouter>,
  );
}

describe('SampleDataNotice', () => {
  beforeEach(async () => {
    await db.beans.clear();
    await db.ratings.clear();
    await db.outbox.clear();
  });

  it('stays out of the way when nothing on screen is invented', async () => {
    renderNotice();

    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
  });

  it('says how much of what is on screen is made up', async () => {
    await loadSampleData();
    renderNotice();

    const count = await db.beans.filter((bean) => bean.isSample === true).count();
    expect(
      await screen.findByText(`These figures include ${count} sample coffees.`),
    ).toBeInTheDocument();
  });

  it('points at the one place the samples can be removed', async () => {
    await loadSampleData();
    renderNotice();

    expect(await screen.findByRole('link', { name: 'Remove them' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('goes away once the samples do', async () => {
    await loadSampleData();
    renderNotice();
    await screen.findByRole('note');

    await removeSampleData();

    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument());
  });
});
