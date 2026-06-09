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
        <p className="text-sm text-muted-foreground">
          Detail layout per <code>specs/ui.md §3</code>. Ratings, photos, attributes go here.
        </p>
      </CardContent>
    </Card>
  );
}
