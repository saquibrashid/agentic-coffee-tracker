import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LongWait } from './long-wait';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LongWait', () => {
  it('announces what is happening', () => {
    render(<LongWait label="Re-shooting the bag…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Re-shooting the bag…');
  });

  /**
   * The reason this component exists. A spinner looks identical after one
   * second and after ninety, so a slow success and a hang are indistinguishable
   * and the rational response is to press the button again. A number that moves
   * is the only part of the display that proves time is passing.
   */
  it('counts the seconds as they pass', () => {
    render(<LongWait label="Working…" />);

    expect(screen.getByText('0s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('3s')).toBeInTheDocument();
  });

  /**
   * Indeterminate deliberately: these are model calls behind a queue, so there
   * is no percentage to report. A progressbar carrying no `aria-valuenow` is
   * the documented way to say "still working, cannot say how far".
   */
  it('reports progress without claiming a position it does not know', () => {
    render(<LongWait label="Working…" />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-label', 'Working…');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('sets the expectation up front when given one', () => {
    render(<LongWait label="Working…" expectation="a minute or so" />);

    expect(screen.getByText(/usually takes a minute or so/)).toBeInTheDocument();
  });

  it('says nothing about timing when it has nothing to promise', () => {
    render(<LongWait label="Working…" />);

    expect(screen.queryByText(/usually takes/)).not.toBeInTheDocument();
  });

  it('stops ticking once it goes away', () => {
    const { unmount } = render(<LongWait label="Working…" />);
    unmount();

    // A timer still firing into an unmounted tree is a React warning today and
    // a leak in a page the user opens repeatedly.
    expect(vi.getTimerCount()).toBe(0);
  });
});
