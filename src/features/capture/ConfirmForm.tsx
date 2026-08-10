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
import { enqueueDelete, enqueueUpsert } from '@/services/sync/outbox';
import type { CoffeeBean, Process, RoastLevel } from '@/types';
import { PROCESSES, ROAST_LEVELS } from '@/services/beans/library';

export interface ConfirmFormProps {
  bean: CoffeeBean;
  /** Raw OCR text, shown when the AI could not produce a usable result. */
  rawText?: string;
  schemaErrors?: string[];
  /**
   * True when these values are synthetic rather than read from the photo. Shown
   * prominently: silently presenting fixtures as a real read is the single most
   * misleading thing this screen can do.
   */
  usedMock?: boolean;
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
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

export function ConfirmForm({ bean, rawText, schemaErrors, usedMock }: ConfirmFormProps) {
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
      // The callback form lets us *remove* roastDate when the field is cleared;
      // an object spec can only ever assign it.
      await db.beans.update(bean.id, (draft) => {
        draft.roaster = form.roaster.trim();
        draft.name = form.name.trim();
        draft.roastLevel = form.roastLevel;
        draft.process = form.process;
        draft.origins = splitList(form.origin).map((country) => ({ country }));
        draft.tastingNotes = splitList(form.tastingNotes);
        if (form.roastDate) {
          draft.roastDate = form.roastDate;
        } else {
          delete draft.roastDate;
        }
        draft.needsReview = false;
        draft.updatedAt = new Date().toISOString();
      });
      await enqueueUpsert('bean', bean.id);
      void navigate(`/beans/${bean.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this coffee.');
      setSaving(false);
    }
  }

  async function onDiscard() {
    await db.beans.delete(bean.id);
    await enqueueDelete('bean', bean.id);
    await db.pendingAiTasks.where('beanId').equals(bean.id).delete();
    void navigate('/');
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      {usedMock && (
        <div
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm dark:border-amber-400/40"
        >
          <p className="font-medium">These are sample values, not your bag.</p>
          <p className="text-muted-foreground">
            AI bag scanning isn&apos;t configured, so the fields below were filled with placeholder
            data. Replace them with the real details before saving.
          </p>
        </div>
      )}

      {schemaErrors && schemaErrors.length > 0 && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 rounded-md border p-3 text-sm"
        >
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
          <p id="origin-hint" className="text-muted-foreground mt-1 text-xs">
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
        <p id="notes-hint" className="text-muted-foreground mt-1 text-xs">
          Comma-separated.
        </p>
      </div>

      {rawText && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Show text read from the bag</summary>
          <pre className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">{rawText}</pre>
        </details>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
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
