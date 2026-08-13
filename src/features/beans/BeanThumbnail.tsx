import { Coffee } from 'lucide-react';

/*
 * The library and the home page both open with a grid of bean cards, and a
 * coffee that has no photo has to occupy the same space as one that does —
 * otherwise the titles in a column stop lining up and the grid reads as ragged.
 * Hence a placeholder tile rather than nothing.
 *
 * The image is decorative: the bean's name and roaster sit next to it in the
 * same card, so alt text here would only make a screen reader say the name
 * twice.
 */
export function BeanThumbnail({ dataUrl }: { dataUrl: string | undefined }) {
  if (!dataUrl) {
    return (
      <div
        className="bg-muted flex size-14 shrink-0 items-center justify-center rounded"
        aria-hidden="true"
      >
        <Coffee className="text-muted-foreground size-6" />
      </div>
    );
  }

  return <img src={dataUrl} alt="" className="size-14 shrink-0 rounded object-cover" />;
}
