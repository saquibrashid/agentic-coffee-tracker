import { LogIn, LogOut, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthUser } from '@/services/auth';

export function HeaderAccountControl() {
  const { user, loading, available, login, logout } = useAuthUser();

  if (!available || loading) return null;

  if (!user) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Sign in"
        className="relative z-10 shrink-0 px-2.5 sm:px-3"
        onClick={() => void login('aad')}
      >
        <LogIn aria-hidden="true" />
        <span className="hidden min-[360px]:inline">Sign in</span>
      </Button>
    );
  }

  const identity = user.displayName ?? 'Signed-in account';
  const initial = identity.charAt(0).toUpperCase();

  return (
    <details className="group relative z-20 shrink-0">
      <summary
        aria-label={`Account for ${identity}`}
        className="bg-background hover:bg-accent focus-visible:ring-ring flex size-9 cursor-pointer list-none items-center justify-center rounded-full border text-sm font-semibold shadow-sm focus-visible:ring-2 focus-visible:outline-hidden [&::-webkit-details-marker]:hidden"
      >
        {initial || <UserRound aria-hidden="true" className="size-4" />}
      </summary>
      <div className="bg-popover text-popover-foreground absolute top-11 right-0 w-64 rounded-lg border p-3 shadow-lg">
        <p className="truncate text-sm font-medium">{identity}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">Microsoft account</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 w-full justify-start"
          onClick={() => void logout()}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </details>
  );
}

export function ReauthenticateButton() {
  const { available, loading, login } = useAuthUser();
  if (!available || loading) return null;

  return (
    <button
      type="button"
      className="ml-1 font-semibold underline underline-offset-2"
      onClick={() => void login('aad')}
    >
      Sign in again
    </button>
  );
}
