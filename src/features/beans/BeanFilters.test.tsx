import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BeanFilters } from './BeanFilters';
import { DEFAULT_FILTERS, type LibraryFacets, type LibraryFilters } from '@/services/beans/library';

const facets: LibraryFacets = {
  roasters: [
    { value: 'Onyx', count: 4 },
    { value: 'Sey', count: 2 },
  ],
  origins: [
    { value: 'Ethiopia', count: 3 },
    { value: 'Colombia', count: 1 },
  ],
  varietals: [
    { value: 'Gesha', count: 2 },
    { value: 'Caturra', count: 1 },
  ],
};

function setup(overrides: Partial<LibraryFilters> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const filters = { ...DEFAULT_FILTERS, ...overrides };
  render(<BeanFilters filters={filters} facets={facets} onChange={onChange} onReset={onReset} />);
  return { onChange, onReset };
}

/**
 * Opens the disclosure. Content inside a closed `<details>` is genuinely
 * hidden — which is the behaviour being relied on — so anything asserting on a
 * filter control has to open it first, exactly as a user does.
 */
function openFilters() {
  const summary = screen.getByText('Filters').closest('summary');
  summary?.parentElement?.setAttribute('open', '');
}

describe('BeanFilters', () => {
  it('keeps search and sort outside the disclosure', () => {
    setup();
    // Both are reached constantly, so burying them behind a click would be a
    // regression on the controls that already existed.
    expect(screen.getByRole('searchbox')).toBeVisible();
    expect(screen.getByLabelText('Sort by')).toBeVisible();
  });

  it('shows how many filters are hiding results', () => {
    setup({ roasters: ['Onyx'], minRating: 8 });
    // The badge sits in the summary, so it is readable while collapsed —
    // otherwise the count could only be seen by opening the thing it describes.
    const summary = screen.getByText('Filters').closest('summary');
    expect(within(summary!).getByText('2')).toBeVisible();
  });

  it('does not count sort, which never hides anything', () => {
    setup({ sort: 'rating' });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers the roasters actually present, with counts', () => {
    setup();
    openFilters();
    const roasters = screen.getByRole('group', { name: 'Roaster' });
    expect(within(roasters).getByRole('checkbox', { name: 'Onyx 4' })).toBeVisible();
    expect(within(roasters).getByRole('checkbox', { name: 'Sey 2' })).toBeVisible();
  });

  it('adds a facet value when a chip is picked', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole('checkbox', { name: /Ethiopia/ }));

    expect(onChange).toHaveBeenCalledWith('origins', ['Ethiopia']);
  });

  it('removes a facet value when an active chip is picked again', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ origins: ['Ethiopia'] });

    await user.click(screen.getByRole('checkbox', { name: /Ethiopia/ }));

    expect(onChange).toHaveBeenCalledWith('origins', []);
  });

  it('accumulates several values within one facet', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ roasters: ['Onyx'] });

    await user.click(screen.getByRole('checkbox', { name: /Sey/ }));

    expect(onChange).toHaveBeenCalledWith('roasters', ['Onyx', 'Sey']);
  });

  // The stored value may be spelled differently from the option label, since
  // the facets are grouped case-insensitively.
  it('matches an active chip regardless of case', () => {
    setup({ roasters: ['onyx'] });
    expect(screen.getByRole('checkbox', { name: /Onyx/ })).toBeChecked();
  });

  it('hides a facet that cannot narrow anything', () => {
    const onChange = vi.fn();
    render(
      <BeanFilters
        filters={DEFAULT_FILTERS}
        facets={{ ...facets, varietals: [{ value: 'Gesha', count: 3 }] }}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );
    // Every visible bean already matches, so the control would be a no-op.
    expect(screen.queryByRole('group', { name: 'Varietal' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Roaster' })).toBeInTheDocument();
  });

  it('converts the rating select to a number, and "any" to null', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.selectOptions(screen.getByLabelText('Minimum rating'), '8');
    expect(onChange).toHaveBeenCalledWith('minRating', 8);

    onChange.mockClear();
    await user.selectOptions(screen.getByLabelText('Minimum rating'), 'any');
    expect(onChange).toHaveBeenCalledWith('minRating', null);
  });

  it('converts the freshness select to a number of days', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.selectOptions(screen.getByLabelText('Freshness'), '14');
    expect(onChange).toHaveBeenCalledWith('roastedWithinDays', 14);
  });

  // Issue #109 asked for this specifically: the exclusion rule has to be
  // visible rather than implied, or a filter silently loses beans.
  it('says that unrated beans are hidden by a rating threshold', () => {
    setup({ minRating: 7 });
    openFilters();
    expect(screen.getByText(/beans you have not rated are hidden/i)).toBeVisible();
  });

  it('says that undated beans are hidden by a freshness window', () => {
    setup({ roastedWithinDays: 30 });
    openFilters();
    expect(screen.getByText(/beans with no roast date are hidden/i)).toBeVisible();
  });

  it('states nothing about exclusions when neither filter is applied', () => {
    setup();
    expect(screen.queryByText(/are hidden/i)).not.toBeInTheDocument();
  });

  it('offers a reset once anything is applied', async () => {
    const user = userEvent.setup();
    const { onReset } = setup({ roasters: ['Onyx'] });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onReset).toHaveBeenCalled();
  });
});
