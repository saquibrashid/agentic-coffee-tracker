import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SwitchAccountPrompt } from './SwitchAccountPrompt';

const assign = vi.fn();
const replaceState = vi.fn();

function atUrl(pathname: string, search: string, hash = ''): void {
  vi.stubGlobal('location', { assign, pathname, search, hash });
  vi.stubGlobal('history', { replaceState });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SwitchAccountPrompt', () => {
  it('stays out of the way on an ordinary page load', () => {
    atUrl('/settings', '?tab=account');
    const { container } = render(<SwitchAccountPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains the remaining step on the return leg of a switch', () => {
    atUrl('/settings', '?switchAccount=1');
    render(<SwitchAccountPrompt />);
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  // Losing the account is the fear this is most likely to trigger, and the
  // answer is the one thing that never changes: the data is local.
  it('says the coffees are safe, because signing out is when people worry', () => {
    atUrl('/settings', '?switchAccount=1');
    render(<SwitchAccountPrompt />);
    expect(screen.getByText(/never deletes them/i)).toBeVisible();
  });

  it('goes to Microsoft only when the user asks it to', async () => {
    atUrl('/settings', '?switchAccount=1');
    render(<SwitchAccountPrompt />);
    expect(assign).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /continue to microsoft/i }));
    expect(assign).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
    );
  });

  it('can be dismissed without leaving the app', async () => {
    atUrl('/settings', '?switchAccount=1');
    render(<SwitchAccountPrompt />);

    await userEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  // Otherwise every reload re-opens it, and any link shared from this page
  // pushes the recipient into signing out of Microsoft.
  it('strips the marker from the address bar as soon as it is read', () => {
    atUrl('/settings', '?tab=account&switchAccount=1');
    render(<SwitchAccountPrompt />);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/settings?tab=account');
  });
});
