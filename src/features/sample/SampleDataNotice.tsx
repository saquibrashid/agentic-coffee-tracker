import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { FlaskConical } from 'lucide-react';

import { db } from '@/services/db';

/**
 * Says out loud that some of what is on screen is made up.
 *
 * Sample coffees are loaded into the real tables so Analytics, "For you" and
 * the predictor genuinely work (#241) — which means that once they are loaded,
 * every number on those screens is partly fiction. Someone who loads them,
 * forgets, and comes back a week later would otherwise read invented averages
 * as their own taste. That is the quiet failure the samples are most likely to
 * cause, and the only defence is saying so where the numbers are.
 *
 * Deliberately not dismissible: dismissing it would restore exactly the silent
 * state it exists to prevent. The way to make it go away is to remove the
 * samples, which is one tap away.
 */
export function SampleDataNotice() {
  const count = useLiveQuery(() => db.beans.filter((b) => b.isSample === true).count(), []) ?? 0;
  if (count === 0) return null;

  return (
    <div
      className="border-muted-foreground/30 bg-muted/50 text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-sm"
      role="note"
    >
      <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
      <span>These figures include {count} sample coffees.</span>
      <Link className="text-foreground font-medium underline underline-offset-2" to="/settings">
        Remove them
      </Link>
    </div>
  );
}
