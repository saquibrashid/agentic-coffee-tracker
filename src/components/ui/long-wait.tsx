import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * A wait long enough that the user needs telling it is still working.
 *
 * A bare spinner is fine for something that takes a moment. It stops being fine
 * somewhere around ten seconds, because a spinner looks exactly the same after
 * one second as after ninety — so a slow success and a hang are indistinguishable,
 * and the rational response to a spinner that has not moved is to press the
 * button again. The counter is the whole point: it is the only part of this that
 * proves time is passing rather than merely asserting it.
 *
 * The bar is deliberately indeterminate. These operations are a model call
 * behind a queue; there is no percentage to report, and animating a made-up one
 * to 90% and parking it there is a lie the user eventually learns to distrust —
 * at which point every real progress bar in the app is worth less.
 *
 * `expectation` is the other half. Telling someone up front that this takes
 * about a minute converts a wait from a fault into a plan, and it belongs on the
 * screen before they commit, not only after.
 */
export interface LongWaitProps {
  /** What is happening, as a sentence the user would recognise. */
  label: string;
  /** Roughly how long it usually takes, e.g. "about a minute". */
  expectation?: string;
  className?: string;
}

/** Seconds since the component mounted, ticking once a second. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    // Derived from the clock rather than incremented, so a tick the browser
    // skips while the tab is backgrounded does not permanently lose a second.
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  return seconds;
}

export function LongWait({ label, expectation, className }: LongWaitProps) {
  const seconds = useElapsedSeconds();

  return (
    <div className={className}>
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="text-primary size-4 shrink-0 animate-spin" aria-hidden="true" />
        <span>{label}</span>
        {/* Not in the live region's sentence: announcing a new number every
            second would talk over everything else a screen reader is saying. */}
        <span aria-hidden="true" className="text-muted-foreground ml-auto tabular-nums">
          {seconds}s
        </span>
      </p>

      <div
        role="progressbar"
        aria-label={label}
        className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div className="bg-primary/70 h-full w-1/3 animate-[long-wait_1.6s_ease-in-out_infinite] rounded-full" />
      </div>

      {expectation && (
        <p className="text-muted-foreground mt-1.5 text-xs">This usually takes {expectation}.</p>
      )}
    </div>
  );
}
