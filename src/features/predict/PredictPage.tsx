/**
 * "Will I like this?" — a pre-tasting check on a coffee the user has not tried.
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
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  HelpCircle,
  Image,
  Link2,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isSchemaError } from '@/services/ai';
import { extractBeanFromPhoto, PipelineUnavailableError } from '@/services/ai/pipeline';
import { EmptyPageError, enrichFromUrl } from '@/services/enrich';
import { dataUrlToBlob, resizeDataUrl } from '@/services/image/imagePipeline';
import { canPredict, loadPredictionIndex, MIN_RATINGS_FOR_PREDICTION } from '@/services/predict';
import {
  explain,
  predict,
  type Evidence,
  type Prediction,
  type Verdict,
} from '@/services/predict/predict';
import { MAX_SCORE } from '@/services/ratings/scale';
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

type BusyKind = 'photo' | 'link';
type ProcessingStage = 'preparing' | 'reading' | 'interpreting';

type CheckSource =
  { kind: 'photo'; previewUrl: string; name: string } | { kind: 'link'; url: string; host: string };

const STAGE_COPY: Record<
  BusyKind,
  Record<ProcessingStage, { title: string; description: string }>
> = {
  photo: {
    preparing: {
      title: 'Preparing your photo',
      description: 'Optimizing the image so the label is clear enough to read.',
    },
    reading: {
      title: 'Reading the bag',
      description: 'Looking for the roaster, origin, process, roast, and tasting notes.',
    },
    interpreting: {
      title: 'Interpreting the details',
      description: 'Turning the label into fields you can review before the verdict.',
    },
  },
  link: {
    preparing: {
      title: 'Opening the coffee page',
      description: 'Fetching readable product information from the source.',
    },
    reading: {
      title: 'Reading the coffee details',
      description: 'Looking for the roaster, origin, process, roast, and tasting notes.',
    },
    interpreting: {
      title: 'Interpreting the details',
      description: 'Turning the page into fields you can review before the verdict.',
    },
  },
};

function splitList(value: string): string[] {
  return value
    .split(/[;,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourceFromUrl(value: string): CheckSource {
  const parsed = new URL(value);
  return { kind: 'link', url: parsed.toString(), host: parsed.hostname.replace(/^www\./, '') };
}

function ProcessingPanel({
  kind,
  stage,
  onCancel,
}: {
  kind: BusyKind;
  stage: ProcessingStage;
  onCancel: () => void;
}) {
  const copy = STAGE_COPY[kind][stage];
  const stages: ProcessingStage[] = ['preparing', 'reading', 'interpreting'];
  const activeIndex = stages.indexOf(stage);

  return (
    <div
      role="status"
      aria-live="polite"
      className="from-primary/12 via-accent/65 to-card overflow-hidden rounded-lg border bg-linear-to-br p-5 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <div className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-full">
          <LoaderCircle className="size-6 motion-safe:animate-spin" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-meta text-primary">Working on your coffee</p>
          <p className="font-display mt-1 text-xl font-semibold">{copy.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{copy.description}</p>
          <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Processing stages">
            {stages.map((item, index) => (
              <li
                key={item}
                className={`rounded-md border px-2 py-2 text-center text-xs ${
                  index <= activeIndex
                    ? 'border-primary/35 bg-primary/10 text-foreground'
                    : 'bg-card/50 text-muted-foreground'
                }`}
              >
                {index < activeIndex ? (
                  <CheckCircle2 className="mx-auto mb-1 size-4" aria-hidden="true" />
                ) : (
                  <span
                    className={`mx-auto mb-1 block size-4 rounded-full border ${
                      index === activeIndex
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    }`}
                    aria-hidden="true"
                  />
                )}
                {item === 'preparing' ? 'Prepare' : item === 'reading' ? 'Read' : 'Review'}
              </li>
            ))}
          </ol>
          <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
            Cancel and start over
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourcePreview({ source }: { source: CheckSource }) {
  return (
    <div className="bg-muted/45 overflow-hidden rounded-lg border">
      {source.kind === 'photo' ? (
        <img
          src={source.previewUrl}
          alt={`Selected coffee bag: ${source.name}`}
          className="max-h-72 w-full object-contain"
        />
      ) : (
        <div className="flex min-h-36 items-center justify-center bg-linear-to-br from-amber-100 to-stone-200 p-6 dark:from-amber-950 dark:to-stone-900">
          <Link2 className="text-primary size-12" aria-hidden="true" />
        </div>
      )}
      <div className="bg-card flex items-center gap-3 border-t px-4 py-3">
        {source.kind === 'photo' ? (
          <Image className="text-primary size-5 shrink-0" aria-hidden="true" />
        ) : (
          <Link2 className="text-primary size-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-meta text-muted-foreground">
            {source.kind === 'photo' ? 'Selected photo' : 'Source page'}
          </p>
          <p className="truncate text-sm font-medium">
            {source.kind === 'photo' ? source.name : source.host}
          </p>
        </div>
      </div>
    </div>
  );
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
      <ul className="text-muted-foreground mt-1 space-y-1 text-sm">
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
          <p className="text-muted-foreground text-sm">
            Predicted <strong data-testid="prediction-score">{prediction.score.toFixed(1)}</strong>/
            {MAX_SCORE} · {confidence}% confidence
          </p>
        </div>
      </div>

      <EvidenceList title="What points that way" items={prediction.supporting} />
      <EvidenceList title="What gives us pause" items={prediction.detracting} />

      {prediction.confidence < 0.25 && (
        <p className="text-muted-foreground text-sm">
          There is little in your history to go on here, so treat this as a shrug rather than an
          answer.
        </p>
      )}

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
  );
}

export function PredictPage() {
  const index = useLiveQuery(() => loadPredictionIndex(), []);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('preparing');
  const [source, setSource] = useState<CheckSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startSession(nextSource: CheckSource | null, kind: BusyKind): number {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setForm(EMPTY_FORM);
    setPrediction(null);
    setError(null);
    setNotice(null);
    setSource(nextSource);
    if (kind === 'photo') setUrl('');
    setBusy(kind);
    setStage('preparing');
    return requestId;
  }

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
    const requestId = startSession(null, 'photo');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (requestId !== requestRef.current) return;
      setSource({ kind: 'photo', previewUrl: dataUrl, name: file.name || 'Coffee bag' });
      const resized = await resizeDataUrl(dataUrl, 1600);
      if (requestId !== requestRef.current) return;
      setStage('reading');
      const result = await extractBeanFromPhoto(dataUrlToBlob(resized.dataUrl));
      if (requestId !== requestRef.current) return;
      setStage('interpreting');
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
      if (requestId !== requestRef.current) return;
      setError(describeFailure(err, 'Something went wrong reading that photo.'));
    } finally {
      if (requestId === requestRef.current) setBusy(null);
      // Let the same file be chosen again after a failure.
      event.target.value = '';
    }
  }

  async function handleLink(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    let nextSource: CheckSource;
    try {
      nextSource = sourceFromUrl(trimmed);
    } catch {
      setError('Enter a valid coffee page URL.');
      return;
    }
    const requestId = startSession(nextSource, 'link');
    try {
      const enriched = await enrichFromUrl(trimmed);
      if (requestId !== requestRef.current) return;
      setStage('interpreting');
      setForm(formFromParsed(enriched.parsed));
      setPrediction(null);
      setNotice('Read from that page. Correct anything below, then check the verdict.');
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(describeFailure(err, 'Could not read that link.'));
    } finally {
      if (requestId === requestRef.current) setBusy(null);
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

  function reset({ focus = false }: { focus?: boolean } = {}) {
    requestRef.current += 1;
    setForm(EMPTY_FORM);
    setPrediction(null);
    setUrl('');
    setBusy(null);
    setStage('preparing');
    setSource(null);
    setError(null);
    setNotice(null);
    if (focus) {
      requestAnimationFrame(() => {
        photoInputRef.current?.focus();
        photoInputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      });
    }
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
          <CardDescription>Check a coffee against your taste before you drink it.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
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
            Check a coffee against your taste before you drink it. Nothing here is saved to your
            library.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div>
            <label htmlFor="predict-photo" className="mb-2 block text-sm font-medium">
              Photo of the bag
            </label>
            <input
              ref={photoInputRef}
              id="predict-photo"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy !== null}
              onChange={(e) => void handlePhoto(e)}
              className="file:bg-primary file:text-primary-foreground block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium"
            />
          </div>

          <form onSubmit={(e) => void handleLink(e)} className="border-t pt-4">
            <Label htmlFor="predict-url" className="mb-2 block">
              Or a link to the coffee
            </Label>
            <div className="flex gap-2">
              <Input
                id="predict-url"
                type="url"
                inputMode="url"
                placeholder="https://roaster.example/coffee"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy !== null}
                className="flex-1"
              />
              <Button type="submit" variant="outline" disabled={busy !== null || !url.trim()}>
                {busy === 'link' ? 'Reading…' : 'Read'}
              </Button>
            </div>
          </form>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-muted-foreground text-sm">
              {notice}
            </p>
          )}
        </CardContent>
      </Card>

      {busy && (
        <ProcessingPanel kind={busy} stage={stage} onCancel={() => reset({ focus: true })} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The coffee</CardTitle>
          <CardDescription>
            Fill in whatever you know. Every field is optional, but the more you give the sharper
            the answer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {source && <SourcePreview source={source} />}
          <form onSubmit={handlePredict} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="predict-roaster" className="mb-1 block">
                  Roaster
                </Label>
                <Input
                  id="predict-roaster"
                  value={form.roaster}
                  onChange={(e) => update({ roaster: e.target.value })}
                  disabled={busy !== null}
                />
              </div>
              <div>
                <Label htmlFor="predict-origin" className="mb-1 block">
                  Origin country
                </Label>
                <Input
                  id="predict-origin"
                  placeholder="Ethiopia, Colombia"
                  value={form.origin}
                  onChange={(e) => update({ origin: e.target.value })}
                  disabled={busy !== null}
                />
              </div>
              <div>
                <Label htmlFor="predict-process" className="mb-1 block">
                  Process
                </Label>
                <Select
                  id="predict-process"
                  value={form.process}
                  onChange={(e) => update({ process: e.target.value as Process | '' })}
                  disabled={busy !== null}
                >
                  {PROCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="predict-roast" className="mb-1 block">
                  Roast level
                </Label>
                <Select
                  id="predict-roast"
                  value={form.roastLevel}
                  onChange={(e) => update({ roastLevel: e.target.value as RoastLevel | '' })}
                  disabled={busy !== null}
                >
                  {ROAST_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="predict-notes" className="mb-1 block">
                Tasting notes
              </Label>
              <Input
                id="predict-notes"
                placeholder="blueberry, cocoa, jasmine"
                value={form.tastingNotes}
                onChange={(e) => update({ tastingNotes: e.target.value })}
                disabled={busy !== null}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={busy !== null || !hasAnyDetail}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                Will I like it?
              </Button>
              {hasAnyDetail && (
                <Button type="button" variant="ghost" onClick={() => reset()}>
                  Start over
                </Button>
              )}
            </div>
          </form>

          {prediction && (
            <div className="space-y-3">
              <VerdictCard prediction={prediction} />
              <Button type="button" variant="outline" onClick={() => reset({ focus: true })}>
                <RotateCcw aria-hidden="true" /> Check another coffee
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
