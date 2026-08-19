/**
 * The answer, as the whole screen rather than a card under a form.
 *
 * The old verdict rendered below the details form and put the two numbers that
 * matter — the score and how much to trust it — in one muted caption. On a
 * phone that meant the thing the user came for arrived off-screen, in the
 * smallest type on the page (#236).
 *
 * Making it louder must not make it look more certain, which is the obvious
 * failure mode of a redesign like this. So the confidence gauge is coloured by
 * confidence, never by the verdict: a 7.6 the predictor is barely sure of shows
 * a big number over a nearly empty, muted bar, and reads as the shrug it is.
 */
import { HelpCircle, ThumbsDown, ThumbsUp } from 'lucide-react';

import { explain, type Evidence, type Prediction, type Verdict } from '@/services/predict/predict';
import { MAX_SCORE } from '@/services/ratings/scale';

const VERDICT_STYLES: Record<
  Verdict,
  { shell: string; badge: string; score: string; Icon: typeof ThumbsUp; label: string }
> = {
  love: {
    shell: 'border-emerald-500/40 bg-emerald-500/10',
    badge: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950',
    score: 'text-emerald-700 dark:text-emerald-300',
    Icon: ThumbsUp,
    label: 'Worth buying',
  },
  like: {
    shell: 'border-emerald-500/30 bg-emerald-500/5',
    badge: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950',
    score: 'text-emerald-700 dark:text-emerald-300',
    Icon: ThumbsUp,
    label: 'Probably yes',
  },
  unsure: {
    shell: 'border-amber-500/40 bg-amber-500/10',
    badge: 'bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-950',
    score: 'text-amber-700 dark:text-amber-300',
    Icon: HelpCircle,
    label: 'Toss-up',
  },
  avoid: {
    shell: 'border-destructive/40 bg-destructive/10',
    badge: 'bg-destructive text-white',
    score: 'text-destructive',
    Icon: ThumbsDown,
    label: 'Probably not',
  },
};

/**
 * Confidence as a word, because a bare percentage invites arithmetic nobody
 * wants to do mid-aisle. The bands are deliberately harsh at the bottom: below
 * a quarter the prediction already tells the user to treat it as a shrug, so
 * the gauge should not be quietly implying otherwise.
 */
const CONFIDENCE_BANDS: { min: number; label: string; bar: string; text: string }[] = [
  {
    min: 0.7,
    label: 'Strong',
    bar: 'bg-emerald-600 dark:bg-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  {
    min: 0.5,
    label: 'Good',
    bar: 'bg-emerald-600/80 dark:bg-emerald-400/80',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  { min: 0.35, label: 'Moderate', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  { min: 0.2, label: 'Low', bar: 'bg-amber-600/70', text: 'text-amber-700 dark:text-amber-300' },
  { min: 0, label: 'Very low', bar: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
];

function confidenceBand(confidence: number) {
  return CONFIDENCE_BANDS.find((band) => confidence >= band.min) ?? CONFIDENCE_BANDS.at(-1)!;
}

function ConfidenceGauge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  const band = confidenceBand(confidence);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-meta text-muted-foreground">Confidence</span>
        <span className={`text-sm font-medium ${band.text}`} data-testid="prediction-confidence">
          {band.label} · {percent}%
        </span>
      </div>
      <div
        role="meter"
        aria-label="Prediction confidence"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${band.label}, ${percent} percent`}
        className="bg-muted mt-1.5 h-2 w-full overflow-hidden rounded-full"
      >
        {/* Never zero-width: an empty track and a missing bar look identical,
            and "we are barely sure" is information worth drawing. */}
        <div
          className={`h-full rounded-full ${band.bar}`}
          style={{ width: `${Math.max(percent, 3)}%` }}
        />
      </div>
    </div>
  );
}

function EvidenceList({ title, items }: { title: string; items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="text-muted-foreground mt-1 space-y-1 text-sm">
        {items.map((item) => (
          <li key={`${item.kind}-${item.label}`}>{explain(item)}</li>
        ))}
      </ul>
    </div>
  );
}

export function VerdictHero({
  prediction,
  title,
  actions,
}: {
  prediction: Prediction;
  title?: string | null;
  actions?: React.ReactNode;
}) {
  const style = VERDICT_STYLES[prediction.verdict];
  const { Icon } = style;

  return (
    <section
      className={`space-y-5 rounded-xl border p-5 shadow-sm sm:p-6 ${style.shell}`}
      data-testid="prediction"
      aria-labelledby="verdict-headline"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {style.label}
        </span>
      </div>

      <div className="flex items-end gap-4">
        <p className={`font-display text-6xl leading-none font-semibold ${style.score}`}>
          <span data-testid="prediction-score">{prediction.score.toFixed(1)}</span>
          <span className="text-muted-foreground ml-1 text-2xl font-normal">/{MAX_SCORE}</span>
        </p>
      </div>

      <div>
        {/* Naming the coffee matters when several are checked from the same
            roaster in a row: without it every verdict looks alike and there is
            nothing to say which one is being answered (#197). */}
        {title ? <p className="text-muted-foreground text-sm">{title}</p> : null}
        <p id="verdict-headline" className="font-display text-xl font-semibold">
          {prediction.headline}
        </p>
      </div>

      <ConfidenceGauge confidence={prediction.confidence} />

      {prediction.confidence < 0.25 && (
        <p className="text-muted-foreground text-sm">
          There is little in your history to go on here, so treat this as a shrug rather than an
          answer.
        </p>
      )}

      <div className="space-y-4 border-t pt-4">
        <EvidenceList title="What points that way" items={prediction.supporting} />
        <EvidenceList title="What gives us pause" items={prediction.detracting} />

        {prediction.unknowns.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Nothing rated yet for: {prediction.unknowns.join(', ')}.
          </p>
        )}

        {prediction.missing.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Add the {prediction.missing.join(', ')} for a sharper answer.
          </p>
        )}
      </div>

      {actions ? <div className="flex flex-wrap gap-2 border-t pt-4">{actions}</div> : null}
    </section>
  );
}
