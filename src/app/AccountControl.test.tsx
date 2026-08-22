import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthUser } from '@/services/auth';
import { HeaderAccountControl, ReauthenticateButton } from './AccountControl';

vi.mock('@/services/auth', () => ({ useAuthUser: vi.fn() }));

const login = vi.fn();
const logout = vi.fn();
const mockedUseAuthUser = vi.mocked(useAuthUser);

function authState(
  overrides: Partial<ReturnType<typeof useAuthUser>> = {},
): ReturnType<typeof useAuthUser> {
  return {
    user: null,
    loading: false,
    available: true,
    login,
    logout,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HeaderAccountControl', () => {
  it('renders nothing while auth is unavailable or loading', () => {
    mockedUseAuthUser.mockReturnValue(authState({ available: false }));
    const { container, rerender } = render(<HeaderAccountControl />);
    expect(container).toBeEmptyDOMElement();

    mockedUseAuthUser.mockReturnValue(authState({ loading: true }));
    rerender(<HeaderAccountControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Microsoft sign-in when signed out', async () => {
    mockedUseAuthUser.mockReturnValue(authState());
    render(<HeaderAccountControl />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith('aad');
  });

  it('shows the account identity and signs out from its menu', async () => {
    mockedUseAuthUser.mockReturnValue(
      authState({
        user: {
          userId: 'user-a',
          displayName: 'sam@example.com',
          provider: 'aad',
        },
      }),
    );
    render(<HeaderAccountControl />);

    await userEvent.click(screen.getByLabelText('Account for sam@example.com'));
    expect(screen.getByText('sam@example.com')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledOnce();
  });

  // Plain sign-out leaves the Microsoft session alone, so signing back in
  // reuses the same account with no chance to choose. These are two different
  // actions and must stay two different calls.
  it('offers a separate switch-account sign-out that reaches Microsoft too', async () => {
    mockedUseAuthUser.mockReturnValue(
      authState({
        user: { userId: 'user-a', displayName: 'sam@example.com', provider: 'aad' },
      }),
    );
    render(<HeaderAccountControl />);

    await userEvent.click(screen.getByLabelText('Account for sam@example.com'));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out and switch account' }));
    expect(logout).toHaveBeenCalledWith('everywhere');
  });

  it('keeps plain sign-out scoped to this app', async () => {
    mockedUseAuthUser.mockReturnValue(
      authState({
        user: { userId: 'user-a', displayName: 'sam@example.com', provider: 'aad' },
      }),
    );
    render(<HeaderAccountControl />);

    await userEvent.click(screen.getByLabelText('Account for sam@example.com'));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledWith();
  });
});

it('offers reauthentication for an expired session notice', async () => {
  mockedUseAuthUser.mockReturnValue(authState());
  render(<ReauthenticateButton />);

  await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  expect(login).toHaveBeenCalledWith('aad');
});
