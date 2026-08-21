import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  MICROSOFT_SIGN_OUT_URL,
  isSwitchAccountReturn,
  withoutSwitchAccountMarker,
} from '@/services/auth/switchAccount';

/**
 * The second half of "switch account", shown on the page load that comes back
 * from `/.auth/logout`.
 *
 * A confirming tap rather than an automatic redirect, for two reasons. The
 * destination is Microsoft's own sign-out page and this app cannot bring the
 * user back from it — Entra only returns to a URL registered on the app
 * registration, and the registration behind the pre-configured provider belongs
 * to Microsoft, not to this deployment. Silently throwing someone to another
 * origin they then have to find their own way back from is worse than saying so
 * first. It is also, on its face, what a hijacked page does.
 */
export function SwitchAccountPrompt() {
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Read once, at first render, rather than in an effect. The marker is removed
  // from the URL just below, so anything re-reading it later would see it gone.
  const [isReturnLeg] = useState(() => isSwitchAccountReturn(window.location.search));

  useEffect(() => {
    if (!isReturnLeg) return;

    // Drop the marker from the address bar immediately. It has been read, and
    // leaving it would re-open this on every reload and travel with any link
    // the user shares from here.
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, '', withoutSwitchAccountMarker(pathname, search, hash));
  }, [isReturnLeg]);

  if (!isReturnLeg || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="switch-account-title"
      className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="bg-card w-full max-w-sm rounded-xl border p-5 shadow-lg">
        <h2 id="switch-account-title" className="font-display text-lg font-semibold">
          One more step
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          You are signed out of Coffee Bean Tracker. Microsoft still remembers you, which is why
          signing back in never asks which account to use.
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          Continue to sign out of Microsoft as well. It finishes on a Microsoft page — come back
          here afterwards and sign in, and you will be able to pick a different account.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              window.location.assign(MICROSOFT_SIGN_OUT_URL);
            }}
          >
            <LogOut aria-hidden="true" />
            Continue to Microsoft
          </Button>
          <Button type="button" variant="ghost" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Your coffees stay on this device either way. Signing out never deletes them.
        </p>
      </div>
    </div>
  );
}
