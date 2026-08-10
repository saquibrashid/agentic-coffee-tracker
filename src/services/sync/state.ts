/**
 * The sync engine's persistent state, in the `meta` store.
 *
 * `specs/sync.md` -> New `meta` keys. These live in `meta` rather than
 * `localStorage` so they share a transaction domain with the records they
 * describe: a cursor that survived while the records it points past did not
 * would silently skip everything in between.
 */
import { ulid } from 'ulid';
import { db } from '@/services/db';

const DEVICE_ID_KEY = 'sync.deviceId';
const CURSOR_KEY = 'sync.cursor';
const LAST_SYNCED_KEY = 'sync.lastSyncedAt';
const ENABLED_KEY = 'sync.enabled';

async function readMeta<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): Promise<T | null> {
  const record = await db.meta.get(key);
  return record && isValid(record.value) ? record.value : null;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * A stable id for this browser profile, minted on first use.
 *
 * Diagnostics only — the server records it on every document so a "my edit
 * disappeared" report can be traced to an origin. Nothing about correctness
 * depends on it, which is why a regenerated id after a data wipe is harmless.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await readMeta(DEVICE_ID_KEY, isString);
  if (existing) return existing;

  const deviceId = ulid();
  await db.meta.put({ key: DEVICE_ID_KEY, value: deviceId });
  return deviceId;
}

/** The highest `seq` this device has successfully applied. 0 means "never synced". */
export async function getCursor(): Promise<number> {
  return (await readMeta(CURSOR_KEY, isNumber)) ?? 0;
}

export async function setCursor(seq: number): Promise<void> {
  await db.meta.put({ key: CURSOR_KEY, value: seq });
}

export async function getLastSyncedAt(): Promise<string | null> {
  return readMeta(LAST_SYNCED_KEY, isString);
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  await db.meta.put({ key: LAST_SYNCED_KEY, value: iso });
}

/**
 * The user's toggle in Settings. Defaults to on: someone who has signed in has
 * already expressed the intent, and asking twice would be a confusing dead end
 * where the account is connected but nothing happens.
 */
export async function isSyncEnabled(): Promise<boolean> {
  return (await readMeta(ENABLED_KEY, isBoolean)) ?? true;
}

export async function setSyncEnabled(enabled: boolean): Promise<void> {
  await db.meta.put({ key: ENABLED_KEY, value: enabled });
}

/**
 * Forgets the cursor, forcing the next cycle to re-pull everything.
 *
 * `lastSyncedAt` goes too: reporting a recent sync while holding no cursor
 * would misrepresent how current the local data is.
 */
export async function clearSyncState(): Promise<void> {
  await db.meta.bulkDelete([CURSOR_KEY, LAST_SYNCED_KEY]);
}
