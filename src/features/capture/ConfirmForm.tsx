import React, { useState } from 'react';
import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

export function ConfirmForm({ beanId, initial }: { beanId: string; initial: Partial<CoffeeBean> }) {
  const [roaster, setRoaster] = useState(initial.roaster || '');
  const [name, setName] = useState(initial.name || '');
  const [roastLevel, setRoastLevel] = useState((initial.roastLevel as any) || 'medium');
  const [tastingNotes, setTastingNotes] = useState((initial.tastingNotes || []).join(', '));
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    try {
      await db.beans.update(beanId, {
        roaster,
        name,
        roastLevel,
        tastingNotes: tastingNotes.split(',').map((s) => s.trim()).filter(Boolean),
        needsReview: false,
        updatedAt: new Date().toISOString(),
      } as any);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium">Roaster</label>
        <input value={roaster} onChange={(e) => setRoaster(e.target.value)} className="w-full rounded border p-2" />
      </div>
      <div>
        <label className="block text-sm font-medium">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border p-2" />
      </div>
      <div>
        <label className="block text-sm font-medium">Roast level</label>
        <input value={roastLevel} onChange={(e) => setRoastLevel(e.target.value)} className="w-full rounded border p-2" />
      </div>
      <div>
        <label className="block text-sm font-medium">Tasting notes (comma separated)</label>
        <input value={tastingNotes} onChange={(e) => setTastingNotes(e.target.value)} className="w-full rounded border p-2" />
      </div>
      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving} className="rounded bg-primary px-3 py-2 text-white">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
