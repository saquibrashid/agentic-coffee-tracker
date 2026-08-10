/**
 * Sign-in, for the Settings page.
 *
 * Identity only. What is actually synced, and the controls for it, live in
 * `SyncPanel` directly below — keeping them apart means the sign-in copy does
 * not have to be rewritten every time the sync feature set changes, which is
 * exactly how it came to be wrong once already.
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
              Signing out stops syncing and leaves every coffee on this device exactly where it is.
              The cloud copy stays until you delete it below.
            </p>
            <Button variant="outline" onClick={() => void logout()}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Signing in keeps your coffees in step across every device you use. It stays optional,
              and you can delete the cloud copy at any time.
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
