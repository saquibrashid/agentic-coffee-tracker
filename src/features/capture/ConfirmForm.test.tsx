import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import { ConfirmForm } from './ConfirmForm';

/**
 * A bulk CSV import has always queued a web lookup for rows with gaps in them,
 * but adding a single coffee never did — which made scanning a bag the *worse*
 * path for metadata, since a bag only prints what the roaster chose to print.
 * These tests pin the lookup to the save, where the user has already told us
 * which gaps are real.
 */

function makeBean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'bean-1',
    schemaVersion: 1,
    roaster: 'Anchorhead',
    name: 'Leviathan Espresso Blend',
    roastLevel: 'unknown',
    process: 'unknown',
    origins: [],
    tastingNotes: [],
    needsReview: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as CoffeeBean;
}

const complete = makeBean({
  id: 'bean-complete',
  roastLevel: 'medium',
  process: 'washed',
  origins: [{ country: 'Ethiopia' }],
  tastingNotes: ['Plum'],
  photoId: 'photo-1',
});

async function seed(bean: CoffeeBean): Promise<void> {
  await db.beans.put(bean);
}

function renderForm(bean: CoffeeBean) {
  return render(
    <MemoryRouter>
      <ConfirmForm bean={bean} rawText="" />
    </MemoryRouter>,
  );
}

async function save(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Save coffee' }));
}

async function webEnrichTasks(beanId: string) {
  const tasks = await db.pendingAiTasks.where('beanId').equals(beanId).toArray();
  return tasks.filter((task) => task.type === 'web-enrich');
}

beforeEach(async () => {
  await db.beans.clear();
  await db.pendingAiTasks.clear();
  await db.outbox.clear();
});

describe('ConfirmForm enrichment queueing', () => {
  it('queues a web lookup when the saved coffee still has gaps', async () => {
    const bean = makeBean();
    await seed(bean);
    renderForm(bean);

    await save();

    await waitFor(async () => {
      expect(await webEnrichTasks(bean.id)).toHaveLength(1);
    });
  });

  it('does not queue a lookup for a coffee that is already complete', async () => {
    await seed(complete);
    renderForm(complete);

    await save();

    // The save itself must still have happened, or the assertion below would
    // pass for the wrong reason.
    await waitFor(async () => {
      expect(await db.outbox.count()).toBeGreaterThan(0);
    });
    expect(await webEnrichTasks(complete.id)).toHaveLength(0);
  });

  it('does not queue a lookup for gaps the user filled in themselves', async () => {
    const bean = makeBean({ photoId: 'photo-2' });
    await seed(bean);
    renderForm(bean);

    await userEvent.type(screen.getByLabelText(/origin/i), 'Ethiopia, Brazil');
    await userEvent.type(screen.getByLabelText(/tasting notes/i), 'Plum, Chocolate');
    await userEvent.selectOptions(screen.getByLabelText(/roast level/i), 'medium-dark');
    await userEvent.selectOptions(screen.getByLabelText(/process/i), 'natural');

    await save();

    await waitFor(async () => {
      expect(await db.outbox.count()).toBeGreaterThan(0);
    });
    expect(await webEnrichTasks(bean.id)).toHaveLength(0);
  });

  it('does not stack duplicate lookups when the same coffee is saved twice', async () => {
    const bean = makeBean();
    await seed(bean);
    const first = renderForm(bean);

    await save();
    await waitFor(async () => {
      expect(await webEnrichTasks(bean.id)).toHaveLength(1);
    });

    first.unmount();
    renderForm(bean);
    await save();

    await waitFor(async () => {
      expect(await webEnrichTasks(bean.id)).toHaveLength(1);
    });
  });

  it('removes the queued lookup when the draft is discarded', async () => {
    const bean = makeBean();
    await seed(bean);
    const first = renderForm(bean);

    await save();
    await waitFor(async () => {
      expect(await webEnrichTasks(bean.id)).toHaveLength(1);
    });

    // A save normally navigates away, leaving the buttons disabled, so the
    // discard is exercised from a fresh mount — which is also how a user meets
    // it after reopening a coffee that already has a lookup queued.
    first.unmount();
    renderForm(bean);

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(async () => {
      expect(await webEnrichTasks(bean.id)).toHaveLength(0);
    });
  });
});

/**
 * The lookup above has run on save since single-add stopped being the worse
 * path for metadata, but the form never mentioned it — so a user either filled
 * in by hand what was about to be filled in for them, or left it blank without
 * knowing the option existed. Reported as the latter.
 */
describe('ConfirmForm lookup notice', () => {
  it('says on the form that gaps get looked up after saving', () => {
    renderForm(makeBean());

    expect(screen.getByText(/looked up on the roaster.s page automatically/i)).toBeInTheDocument();
  });
});
