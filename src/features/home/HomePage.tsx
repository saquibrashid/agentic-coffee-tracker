import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coffee, Plus } from 'lucide-react';

import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
      <Card className="mx-auto max-w-xl text-center">
        <CardHeader>
          <Coffee className="mx-auto size-12 text-primary" aria-hidden="true" />
          <CardTitle>Welcome to your coffee log</CardTitle>
          <CardDescription>
            Snap a photo of your first bag and we&apos;ll fill in the details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg">
            <Link to="/add">
              <Plus aria-hidden="true" /> Add your first coffee
            </Link>
          </Button>
        </CardContent>
      </Card>
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
                <Card className="transition hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="text-lg">{b.name}</CardTitle>
                    <CardDescription>{b.roaster}</CardDescription>
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
