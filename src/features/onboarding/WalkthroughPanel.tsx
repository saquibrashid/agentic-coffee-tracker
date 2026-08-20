import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WALKTHROUGH } from '@/services/onboarding/hints';
import { resetHints } from '@/services/onboarding/store';

/**
 * The walkthrough, on demand.
 *
 * The hints on Home are the primary explanation, but they are transient by
 * design — each one disappears once the user is past it, and a hurried dismiss
 * loses it for good. This panel is the same content, permanently reachable, so
 * "how does this thing work?" has an answer that does not depend on the user
 * having been in the right state at the right moment (#241).
 */
export function WalkthroughPanel() {
  const [restored, setRestored] = useState(false);

  const restore = useCallback(() => {
    void resetHints().then(() => setRestored(true));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Compass className="size-4" aria-hidden="true" /> How this app works
        </CardTitle>
        <CardDescription>
          A quick tour of the main features, in the order they become useful.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-4">
          {WALKTHROUGH.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <Link to={step.to} className="font-medium hover:underline">
                  {step.title}
                </Link>
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" variant="outline" size="sm" onClick={restore}>
            Show hints again
          </Button>
          <p className="text-muted-foreground text-sm">
            {restored
              ? 'Hints restored. Any that still apply will reappear on the home screen.'
              : 'Brings back any tips you dismissed on the home screen.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
