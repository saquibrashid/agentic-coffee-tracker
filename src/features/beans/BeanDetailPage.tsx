import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/services/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function BeanDetailPage() {
  const { beanId } = useParams<{ beanId: string }>();
  const bean = useLiveQuery(() => (beanId ? db.beans.get(beanId) : undefined), [beanId]);

  if (bean === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (bean === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bean not found</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{bean.name}</CardTitle>
        <p className="text-sm text-muted-foreground">{bean.roaster}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Attributes</h3>
            <p className="text-sm text-muted-foreground">Roast: {bean.roastLevel || '—'}</p>
            <p className="text-sm text-muted-foreground">Origins: {(bean.origins || []).map((o:any)=>o.country).join(', ') || '—'}</p>
          </div>

          <div>
            <h3 className="text-sm font-medium">Ratings</h3>
            <RatingsList beanId={bean.id} />
            <AddRatingForm beanId={bean.id} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RatingsList({ beanId }: { beanId: string }) {
  const ratings = useLiveQuery(() => db.ratings.where('beanId').equals(beanId).reverse().toArray(), [beanId]);
  if (ratings === undefined) return <Skeleton className="h-24" />;
  if (ratings.length === 0) return <p className="text-sm text-muted-foreground">No ratings yet.</p>;
  return (
    <ul className="space-y-2">
      {ratings.map((r) => (
        <li key={r.id} className="border rounded p-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{r.score} / 5</div>
              <div className="text-sm text-muted-foreground">{r.brewType} — {new Date(r.ratedAt).toLocaleString()}</div>
            </div>
          </div>
          {r.notes && <p className="mt-2 text-sm">{r.notes}</p>}
        </li>
      ))}
    </ul>
  );
}

function AddRatingForm({ beanId }: { beanId: string }) {
  const [score, setScore] = useState(4);
  const [brewType, setBrewType] = useState('drip');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function onAdd() {
    setSaving(true);
    try {
      const id = ulid();
      const now = new Date().toISOString();
      await db.ratings.add({
        id,
        schemaVersion: 1,
        beanId,
        score,
        brewType: brewType as any,
        notes,
        ratedAt: now,
        createdAt: now,
        updatedAt: now,
      } as any);
      setNotes('');
      setScore(4);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-2">
        <select value={score} onChange={(e)=>setScore(Number(e.target.value))} className="rounded border p-2">
          {[5,4,3,2,1].map(n=> <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={brewType} onChange={(e)=>setBrewType(e.target.value)} className="rounded border p-2">
          <option value="drip">Drip</option>
          <option value="espresso">Espresso</option>
          <option value="pour-over">Pour-over</option>
          <option value="latte">Latte</option>
          <option value="other">Other</option>
        </select>
      </div>
      <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} className="w-full rounded border p-2" placeholder="Tasting notes (optional)" />
      <div className="flex justify-end">
        <button onClick={onAdd} disabled={saving} className="rounded bg-primary px-3 py-2 text-white">{saving ? 'Adding…' : 'Add rating'}</button>
      </div>
    </div>
  );
}
