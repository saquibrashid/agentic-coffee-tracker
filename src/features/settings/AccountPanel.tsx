/**
 * Sign-in, for the Settings page.
 *
 * Phase 1 of `specs/sync.md`: an account exists and can be signed in and out of,
 * but nothing is uploaded yet. The copy has to be honest about that — an account
 * that quietly does nothing is worse than no account, because people will assume
 * their data is backed up when it is not.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthUser } from '@/services/auth';

export function AccountPanel() {
  const { user, loading, available, login, logout, error } = useAuthUser();

  // Nothing to offer in a local-only build, and an explanation nobody asked for
  // is just noise. Staying local-only is the app working as designed.
  if (!available) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-muted-foreground text-sm">Checking…</p>
        ) : user ? (
          <>
            <p className="text-sm">
              Signed in as <span className="font-medium">{user.displayName ?? user.userId}</span>.
            </p>
            <p className="text-muted-foreground text-sm">
              Syncing between devices is not switched on yet, so your coffees still live only on
              this device. Signing out leaves all of them exactly where they are.
            </p>
            <Button variant="outline" onClick={() => void logout()}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Signing in will let you use the same coffees on more than one device. Nothing is
              uploaded yet — that arrives in a later update, and it stays optional.
            </p>
            <Button onClick={() => void login('aad')}>Sign in with Microsoft</Button>
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
