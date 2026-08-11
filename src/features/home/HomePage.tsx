import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coffee, Plus } from 'lucide-react';

import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RoastScale } from '@/components/ui/roast-scale';
import { Skeleton } from '@/components/ui/skeleton';

export function HomePage() {
  const beans = useLiveQuery(() => db.beans.orderBy('createdAt').reverse().limit(6).toArray(), []);
  const totalBeans = useLiveQuery(() => db.beans.count(), []);

  // Loading
  if (beans === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Empty
  if (beans.length === 0) {
    return (
      <EmptyState
        icon={<Coffee />}
        title="Welcome to your coffee log"
        description="Snap a photo of a bag and we'll read the roaster, origin and tasting notes off the label for you."
        action={
          <Button asChild size="lg">
            <Link to="/add">
              <Plus aria-hidden="true" /> Add your first coffee
            </Link>
          </Button>
        }
      />
    );
  }

  // Success
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent beans</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {beans.map((b) => (
            <li key={b.id}>
              <Link to={`/beans/${b.id}`} className="block">
                <Card className="h-full transition hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="text-lg">{b.name}</CardTitle>
                    <CardDescription>{b.roaster}</CardDescription>
                    <RoastScale level={b.roastLevel} compact className="pt-1" />
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Button asChild variant="outline">
            <Link to="/beans">View all {totalBeans ?? beans.length} beans</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
