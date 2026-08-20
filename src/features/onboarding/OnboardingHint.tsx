import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Lightbulb, X } from 'lucide-react';

import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { nextHint, type Hint } from '@/services/onboarding/hints';
import { dismissHint, readOnboarding } from '@/services/onboarding/store';

/**
 * The one piece of guidance worth showing on Home right now, or nothing.
 *
 * Lives only on Home. The same card repeated on every screen is a nag rather
 * than a tutorial, and Home is the screen a user returns to between actions —
 * which is exactly when "what should I do next?" is a real question (#241).
 */
export function OnboardingHint() {
  const hint = useLiveQuery(async () => {
    const [beans, ratings, state] = await Promise.all([
      db.beans.toArray(),
      db.ratings.count(),
      readOnboarding(),
    ]);
    const active = beans.filter((bean) => !bean.isArchived);

    return nextHint({
      beans: active.length,
      ratings,
      // Any single assisted capture is proof enough that the user knows the
      // feature exists; a library of thirty manual entries is the signal that
      // they do not.
      usedAssistedCapture: active.some(
        (bean) => bean.source === 'photo-ocr' || bean.source === 'url-scrape',
      ),
      visited: state.visited,
      dismissed: state.dismissed,
    });
  }, []);

  if (!hint) return null;
  // Keyed by hint id: dismissing one and immediately being shown the next
  // should render a fresh card rather than inherit the previous one's pending
  // state.
  return <HintCard key={hint.id} hint={hint} />;
}

function HintCard({ hint }: { hint: Hint }) {
  // Hides the card at the click rather than waiting on the Dexie write and the
  // live query to come back around; without it the tip sits there for a beat
  // after the user has asked it to go away.
  const [dismissing, setDismissing] = useState(false);

  const dismiss = useCallback(() => {
    setDismissing(true);
    void dismissHint(hint.id);
  }, [hint.id]);

  if (dismissing) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex items-start gap-3 pt-6">
        <Lightbulb className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{hint.title}</p>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{hint.body}</p>
          <div className="mt-3">
            <Button asChild size="sm">
              {/*
                Taking the hint dismisses it. Leaving it up after the user has
                acted on it would make the card a permanent fixture of Home
                until they thought to close it by hand.
              */}
              <Link to={hint.cta.to} onClick={dismiss}>
                {hint.cta.label}
              </Link>
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={`Dismiss: ${hint.title}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mt-1 -mr-1 shrink-0 rounded-full p-1 focus-visible:ring-2 focus-visible:outline-hidden"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </CardContent>
    </Card>
  );
}
