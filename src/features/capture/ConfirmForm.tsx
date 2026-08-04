/**
 * Review-and-edit step for an AI-extracted bean (specs/ui.md §2, specs/ux-states.md).
 *
 * The AI result is always a *draft*: every field stays editable and the record is
 * only cleared of `needsReview` once the user explicitly confirms it.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { db } from '@/services/db';
import type { CoffeeBean, Process, RoastLevel } from '@/types';

const ROAST_LEVELS: RoastLevel[] = [
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark',
  'unknown',
];

const PROCESSES: Process[] = [
  'washed',
  'natural',
  'honey',
  'anaerobic',
  'wet-hulled',
  'other',
  'unknown',
];

export interface ConfirmFormProps {
  bean: CoffeeBean;
  /** Raw OCR text, shown when the AI could not produce a usable result. */
  rawText?: string;
  schemaErrors?: string[];
}

interface FormState {
  roaster: string;
  name: string;
  roastLevel: RoastLevel;
  process: Process;
  origin: string;
  tastingNotes: string;
  roastDate: string;
}

function toFormState(bean: CoffeeBean): FormState {
  return {
    roaster: bean.roaster === 'Unknown' ? '' : bean.roaster,
    name: bean.name === 'Draft from photo' ? '' : bean.name,
    roastLevel: bean.roastLevel ?? 'unknown',
    process: bean.process ?? 'unknown',
    origin: bean.origins?.map((o) => o.country).join(', ') ?? '',
    tastingNotes: bean.tastingNotes?.join(', ') ?? '',
    roastDate: bean.roastDate ?? '',
  };
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ConfirmForm({ bean, rawText, schemaErrors }: ConfirmFormProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => toFormState(bean));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.roaster.trim() || !form.name.trim()) {
      setError('Roaster and coffee name are both required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await db.beans.update(bean.id, {
        roaster: form.roaster.trim(),
        name: form.name.trim(),
        roastLevel: form.roastLevel,
        process: form.process,
        origins: splitList(form.origin).map((country) => ({ country })),
        tastingNotes: splitList(form.tastingNotes),
        roastDate: form.roastDate || undefined,
        needsReview: false,
        updatedAt: new Date().toISOString(),
      });
      void navigate(`/beans/${bean.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this coffee.');
      setSaving(false);
    }
  }

  async function onDiscard() {
    await db.beans.delete(bean.id);
    await db.pendingAiTasks.where('beanId').equals(bean.id).delete();
    void navigate('/');
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {schemaErrors && schemaErrors.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium">We couldn&apos;t read this bag reliably.</p>
          <p className="text-muted-foreground">Fill in the details below — nothing was lost.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="roaster" className="mb-1 block text-sm font-medium">
            Roaster <span aria-hidden="true">*</span>
          </label>
          <input
            id="roaster"
            className={inputClass}
            required
            value={form.roaster}
            onChange={(e) => set('roaster', e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Coffee name <span aria-hidden="true">*</span>
          </label>
          <input
            id="name"
            className={inputClass}
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="roastLevel" className="mb-1 block text-sm font-medium">
            Roast level
          </label>
          <select
            id="roastLevel"
            className={inputClass}
            value={form.roastLevel}
            onChange={(e) => set('roastLevel', e.target.value as RoastLevel)}
          >
            {ROAST_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="process" className="mb-1 block text-sm font-medium">
            Process
          </label>
          <select
            id="process"
            className={inputClass}
            value={form.process}
            onChange={(e) => set('process', e.target.value as Process)}
          >
            {PROCESSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="origin" className="mb-1 block text-sm font-medium">
            Origin countries
          </label>
          <input
            id="origin"
            className={inputClass}
            placeholder="Ethiopia, Colombia"
            aria-describedby="origin-hint"
            value={form.origin}
            onChange={(e) => set('origin', e.target.value)}
          />
          <p id="origin-hint" className="mt-1 text-xs text-muted-foreground">
            Comma-separated.
          </p>
        </div>

        <div>
          <label htmlFor="roastDate" className="mb-1 block text-sm font-medium">
            Roast date
          </label>
          <input
            id="roastDate"
            type="date"
            className={inputClass}
            value={form.roastDate}
            onChange={(e) => set('roastDate', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label htmlFor="tastingNotes" className="mb-1 block text-sm font-medium">
          Tasting notes
        </label>
        <input
          id="tastingNotes"
          className={inputClass}
          placeholder="chocolate, citrus, floral"
          aria-describedby="notes-hint"
          value={form.tastingNotes}
          onChange={(e) => set('tastingNotes', e.target.value)}
        />
        <p id="notes-hint" className="mt-1 text-xs text-muted-foreground">
          Comma-separated.
        </p>
      </div>

      {rawText && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Show text read from the bag</summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{rawText}</pre>
        </details>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save coffee'}
        </Button>
        <Button type="button" variant="outline" onClick={() => void onDiscard()} disabled={saving}>
          Discard
        </Button>
      </div>
    </form>
  );
}
