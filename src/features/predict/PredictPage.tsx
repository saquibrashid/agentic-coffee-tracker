/**
 * "Will I like this?" — a pre-purchase check on a coffee the user has not tried.
 *
 * Nothing is written to the library. That is the point of the screen: it answers
 * a question you ask while standing in a shop, and a coffee you decided against
 * must not end up in the history skewing every later prediction.
 *
 * The three inputs (photo, link, typing) all converge on the same editable form
 * rather than each producing a verdict directly. A bag photo is read with OCR
 * and is often imperfect, so the user gets to correct it before the prediction
 * is drawn — and the correction costs nothing, because the estimate is local.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, ThumbsDown, ThumbsUp, HelpCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isSchemaError } from '@/services/ai';
import { extractBeanFromPhoto, PipelineUnavailableError } from '@/services/ai/pipeline';
import { EmptyPageError, enrichFromUrl } from '@/services/enrich';
import { dataUrlToBlob, resizeDataUrl } from '@/services/image/imagePipeline';
import {
  canPredict,
  loadPredictionIndex,
  MIN_RATINGS_FOR_PREDICTION,
} from '@/services/predict';
import { explain, predict, type Evidence, type Prediction, type Verdict } from '@/services/predict/predict';
import type { ParsedBean } from '@/services/ai';
import type { Process, RoastLevel } from '@/types';

const PROCESS_OPTIONS: { value: Process | ''; label: string }[] = [
  { value: '', label: 'Not sure' },
  { value: 'washed', label: 'Washed' },
  { value: 'natural', label: 'Natural' },
  { value: 'honey', label: 'Honey' },
  { value: 'anaerobic', label: 'Anaerobic' },
  { value: 'wet-hulled', label: 'Wet-hulled' },
  { value: 'other', label: 'Other' },
];

const ROAST_OPTIONS: { value: RoastLevel | ''; label: string }[] = [
  { value: '', label: 'Not sure' },
  { value: 'light', label: 'Light' },
  { value: 'medium-light', label: 'Medium-light' },
  { value: 'medium', label: 'Medium' },
  { value: 'medium-dark', label: 'Medium-dark' },
  { value: 'dark', label: 'Dark' },
];

const VERDICT_STYLES: Record<Verdict, { className: string; Icon: typeof ThumbsUp }> = {
  love: { className: 'border-emerald-500/40 bg-emerald-500/10', Icon: ThumbsUp },
  like: { className: 'border-emerald-500/30 bg-emerald-500/5', Icon: ThumbsUp },
  unsure: { className: 'border-amber-500/40 bg-amber-500/10', Icon: HelpCircle },
  avoid: { className: 'border-destructive/40 bg-destructive/10', Icon: ThumbsDown },
};

interface FormState {
  roaster: string;
  origin: string;
  process: Process | '';
  roastLevel: RoastLevel | '';
  tastingNotes: string;
}

const EMPTY_FORM: FormState = {
  roaster: '',
  origin: '',
  process: '',
  roastLevel: '',
  tastingNotes: '',
};

function splitList(value: string): string[] {
  return value
    .split(/[;,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Folds a parsed bag or product page into the form the user can correct. */
function formFromParsed(parsed: ParsedBean): FormState {
  return {
    roaster: parsed.roaster ?? '',
    origin: parsed.origins
      .map((o) => o.country)
      .filter((c): c is string => Boolean(c))
      .join(', '),
    process: parsed.process ?? '',
    roastLevel: parsed.roastLevel ?? '',
    tastingNotes: parsed.tastingNotes.join(', '),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function EvidenceList({ title, items }: { title: string; items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={`${item.kind}-${item.label}`}>{explain(item)}</li>
        ))}
      </ul>
    </div>
  );
}

function VerdictCard({ prediction }: { prediction: Prediction }) {
  const { className, Icon } = VERDICT_STYLES[prediction.verdict];
  const confidence = Math.round(prediction.confidence * 100);

  return (
    <div className={`space-y-4 rounded-md border p-4 ${className}`} data-testid="prediction">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">{prediction.headline}</p>
          <p className="text-sm text-muted-foreground">
            Predicted <strong data-testid="prediction-score">{prediction.score.toFixed(1)}</strong>
            /5 · {confidence}% confidence
          </p>
        </div>
      </div>

      <EvidenceList title="What points that way" items={prediction.supporting} />
      <EvidenceList title="What gives us pause" items={prediction.detracting} />

      {prediction.confidence < 0.25 && (
        <p className="text-sm text-muted-foreground">
          There is little in your history to go on here, so treat this as a shrug rather than an
          answer.
        </p>
      )}

      {prediction.unknowns.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing rated yet for: {prediction.unknowns.join(', ')}.
        </p>
      )}

      {prediction.missing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Add the {prediction.missing.join(', ')} for a sharper answer.
        </p>
      )}
    </div>
  );
}

export function PredictPage() {
  const index = useLiveQuery(() => loadPredictionIndex(), []);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'photo' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    // The form has changed, so the verdict on screen is about a different coffee.
    setPrediction(null);
  }

  function describeFailure(err: unknown, fallback: string): string {
    if (err instanceof EmptyPageError) return err.message;
    if (err instanceof PipelineUnavailableError) {
      return 'We could not reach the lookup service. You can still type the details in below.';
    }
    if (isSchemaError(err)) return 'We could not make sense of that. Try typing the details below.';
    return err instanceof Error ? err.message : fallback;
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusy('photo');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const resized = await resizeDataUrl(dataUrl, 1600);
      const result = await extractBeanFromPhoto(dataUrlToBlob(resized.dataUrl));
      if (!result.parsed) {
        setError('We could not read that label. Try typing the details below.');
        return;
      }
      setForm(formFromParsed(result.parsed));
      setPrediction(null);
      setNotice(
        result.usedMock
          ? 'That was read with sample data, not your photo — check the details before trusting the answer.'
          : 'Read from the photo. Correct anything below, then check the verdict.',
      );
    } catch (err) {
      setError(describeFailure(err, 'Something went wrong reading that photo.'));
    } finally {
      setBusy(null);
      // Let the same file be chosen again after a failure.
      event.target.value = '';
    }
  }

  async function handleLink(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setNotice(null);
    setBusy('link');
    try {
      const enriched = await enrichFromUrl(trimmed);
      setForm(formFromParsed(enriched.parsed));
      setPrediction(null);
      setNotice('Read from that page. Correct anything below, then check the verdict.');
    } catch (err) {
      setError(describeFailure(err, 'Could not read that link.'));
    } finally {
      setBusy(null);
    }
  }

  function handlePredict(event: FormEvent) {
    event.preventDefault();
    if (!index) return;
    setPrediction(
      predict(
        {
          roaster: form.roaster.trim() || undefined,
          origins: splitList(form.origin).map((country) => ({ country })),
          process: form.process || undefined,
          roastLevel: form.roastLevel || undefined,
          tastingNotes: splitList(form.tastingNotes),
        },
        index,
      ),
    );
  }

  function reset() {
    setForm(EMPTY_FORM);
    setPrediction(null);
    setUrl('');
    setError(null);
    setNotice(null);
  }

  const hasAnyDetail =
    form.roaster.trim() !== '' ||
    form.origin.trim() !== '' ||
    form.tastingNotes.trim() !== '' ||
    form.process !== '' ||
    form.roastLevel !== '';

  if (!index) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!canPredict(index)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Will I like it?</CardTitle>
          <CardDescription>
            Check a coffee against your taste before you buy it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This works by comparing a coffee against what you have already rated, so it needs a
            little history first. Rate at least {MIN_RATINGS_FOR_PREDICTION} cups — you have{' '}
            {index.totalRatings} — or bulk-import your existing notes from Settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Will I like it?</CardTitle>
          <CardDescription>
            Check a coffee against your taste before you buy it. Nothing here is saved to your
            library.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div>
            <label htmlFor="predict-photo" className="mb-2 block text-sm font-medium">
              Photo of the bag
            </label>
            <input
              id="predict-photo"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy !== null}
              onChange={(e) => void handlePhoto(e)}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
            />
          </div>

          <form onSubmit={(e) => void handleLink(e)} className="border-t pt-4">
            <label htmlFor="predict-url" className="mb-2 block text-sm font-medium">
              Or a link to the coffee
            </label>
            <div className="flex gap-2">
              <input
                id="predict-url"
                type="url"
                inputMode="url"
                placeholder="https://roaster.example/coffee"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" variant="outline" disabled={busy !== null || !url.trim()}>
                {busy === 'link' ? 'Reading…' : 'Read'}
              </Button>
            </div>
          </form>

          {busy === 'photo' && (
            <p role="status" className="text-sm text-muted-foreground">
              Reading the label…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The coffee</CardTitle>
          <CardDescription>
            Fill in whatever you know. Every field is optional, but the more you give the sharper
            the answer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePredict} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="predict-roaster" className="mb-1 block text-sm font-medium">
                  Roaster
                </label>
                <input
                  id="predict-roaster"
                  value={form.roaster}
                  onChange={(e) => update({ roaster: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="predict-origin" className="mb-1 block text-sm font-medium">
                  Origin country
                </label>
                <input
                  id="predict-origin"
                  placeholder="Ethiopia, Colombia"
                  value={form.origin}
                  onChange={(e) => update({ origin: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="predict-process" className="mb-1 block text-sm font-medium">
                  Process
                </label>
                <select
                  id="predict-process"
                  value={form.process}
                  onChange={(e) => update({ process: e.target.value as Process | '' })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {PROCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="predict-roast" className="mb-1 block text-sm font-medium">
                  Roast level
                </label>
                <select
                  id="predict-roast"
                  value={form.roastLevel}
                  onChange={(e) => update({ roastLevel: e.target.value as RoastLevel | '' })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ROAST_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="predict-notes" className="mb-1 block text-sm font-medium">
                Tasting notes
              </label>
              <input
                id="predict-notes"
                placeholder="blueberry, cocoa, jasmine"
                value={form.tastingNotes}
                onChange={(e) => update({ tastingNotes: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={!hasAnyDetail}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                Will I like it?
              </Button>
              {hasAnyDetail && (
                <Button type="button" variant="ghost" onClick={reset}>
                  Clear
                </Button>
              )}
            </div>
          </form>

          {prediction && (
            <div className="mt-4">
              <VerdictCard prediction={prediction} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
