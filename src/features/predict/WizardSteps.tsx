/**
 * The three steps of a check, drawn as a progress rail.
 *
 * The flow was always Source → Details → Verdict; it was just presented as one
 * long scroll, so nothing said that filling the form led anywhere (#236).
 *
 * Steps are not clickable. Step 2 is reachable from step 1 by several routes
 * (read a photo, read a link, or decline both and type it out) and step 3 only
 * exists once a verdict has been computed, so a rail that could be clicked
 * would advertise transitions that are not always legal. Navigation stays with
 * the buttons inside each step, which know what they are allowed to do.
 */
import { Check } from 'lucide-react';

const PREDICT_STEPS = ['source', 'details', 'verdict'] as const;

export type PredictStep = (typeof PREDICT_STEPS)[number];

const STEP_LABELS: Record<PredictStep, string> = {
  source: 'Coffee',
  details: 'Details',
  verdict: 'Verdict',
};

export function WizardSteps({ current }: { current: PredictStep }) {
  const activeIndex = PREDICT_STEPS.indexOf(current);

  return (
    <ol className="flex items-center gap-2" aria-label="Check progress">
      {PREDICT_STEPS.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={step} className="flex flex-1 items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                active
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : done
                    ? 'border-primary/25 text-muted-foreground'
                    : 'text-muted-foreground/70 border-dashed'
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : done
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted'
                }`}
                aria-hidden="true"
              >
                {done ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="truncate">{STEP_LABELS[step]}</span>
              {/* Spoken order without leaning on the visual rail. */}
              <span className="sr-only">
                {`step ${index + 1} of ${PREDICT_STEPS.length}`}
                {done ? ', done' : ''}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
