import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CollapsibleCard, CollapsibleCardHeadingLevel } from './collapsible-card';

describe('CollapsibleCard', () => {
  it('stays shut until it is opened', () => {
    render(
      <CollapsibleCard title="Sync">
        <p>Body text</p>
      </CollapsibleCard>,
    );

    // `<details>` keeps its children in the DOM, which is what lets
    // find-in-page reach them. "Closed" means not visible, not absent.
    expect(screen.getByText('Body text')).not.toBeVisible();
  });

  it('says what is inside without being opened', () => {
    render(
      <CollapsibleCard title="Sync" hint="Synced 2 minutes ago">
        <p>Body text</p>
      </CollapsibleCard>,
    );

    expect(screen.getByText('Synced 2 minutes ago')).toBeVisible();
  });

  it('shows no dot when nothing wants the user', () => {
    render(
      <CollapsibleCard title="Sync" hint="Synced 2 minutes ago">
        <p>Body</p>
      </CollapsibleCard>,
    );

    expect(screen.queryByTestId('attention-dot')).toBeNull();
  });

  it('marks a row that wants the user, in words as well as colour', () => {
    // The dot cannot be the only signal: colour alone must not carry meaning
    // (WCAG 1.4.1), and a coloured span says nothing to a screen reader.
    render(
      <CollapsibleCard title="Fill in missing details" attention="1 coffee is missing details">
        <p>Body</p>
      </CollapsibleCard>,
    );

    expect(screen.getByTestId('attention-dot')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /1 coffee is missing details/ }),
    ).toBeInTheDocument();
  });

  it('is an h2 on its own', () => {
    render(
      <CollapsibleCard title="Sync">
        <p>Body</p>
      </CollapsibleCard>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Sync' })).toBeInTheDocument();
  });

  it('drops to an h3 inside a group', () => {
    // A section must not outrank the heading it sits beneath, or the outline a
    // screen reader announces comes out inverted.
    render(
      <CollapsibleCardHeadingLevel level="h3">
        <CollapsibleCard title="Sync">
          <p>Body</p>
        </CollapsibleCard>
      </CollapsibleCardHeadingLevel>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Sync' })).toBeInTheDocument();
  });
});
