/** Maps the LLM contract (`ParsedBean`) onto the local `CoffeeBean` record. */
import type { ParsedBean } from '@/services/ai';
import type { CoffeeBean, Origin } from '@/types';

function toOrigins(parsed: ParsedBean): Origin[] | undefined {
  const origins = parsed.origins
    .filter((o) => o.country !== null)
    .map((o) => {
      const origin: Origin = { country: o.country as string };
      if (o.region) origin.region = o.region;
      if (o.farm) origin.farm = o.farm;
      if (o.producer) origin.producer = o.producer;
      if (typeof o.percentage === 'number') origin.percentage = o.percentage;
      return origin;
    });
  return origins.length > 0 ? origins : undefined;
}

function toElevation(parsed: ParsedBean): CoffeeBean['elevationMeters'] {
  const el = parsed.elevationMeters;
  if (!el || (el.min === null && el.max === null)) return undefined;
  const out: { min?: number; max?: number } = {};
  if (typeof el.min === 'number') out.min = el.min;
  if (typeof el.max === 'number') out.max = el.max;
  return out;
}

/**
 * Only fields the model actually resolved are returned, so a sparse parse never
 * blanks out data the user already entered.
 */
export function parsedBeanToUpdate(parsed: ParsedBean): Partial<CoffeeBean> {
  const update: Partial<CoffeeBean> = {};

  if (parsed.roaster) update.roaster = parsed.roaster;
  if (parsed.name) update.name = parsed.name;

  const origins = toOrigins(parsed);
  if (origins) update.origins = origins;

  if (parsed.process) update.process = parsed.process;
  if (parsed.roastLevel) update.roastLevel = parsed.roastLevel;
  if (parsed.varietals.length > 0) update.varietals = parsed.varietals;
  if (parsed.tastingNotes.length > 0) update.tastingNotes = parsed.tastingNotes;
  if (parsed.roasterDescription) update.roasterDescription = parsed.roasterDescription;
  if (parsed.roastDate) update.roastDate = parsed.roastDate;

  const elevation = toElevation(parsed);
  if (elevation) update.elevationMeters = elevation;

  update.confidence = parsed.confidence;
  return update;
}
