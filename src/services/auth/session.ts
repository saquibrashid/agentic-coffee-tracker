import { db } from '@/services/db';

const LAST_USER_ID_KEY = 'auth.lastUserId';
const SIGNED_OUT_KEY = 'auth.signedOut';

export async function rememberAuthUser(userId: string): Promise<boolean> {
  return db.transaction('rw', db.meta, async () => {
    const signedOut = await db.meta.get(SIGNED_OUT_KEY);
    if (signedOut?.value === true) return false;
    await db.meta.put({ key: LAST_USER_ID_KEY, value: userId });
    return true;
  });
}

export async function hasRememberedAuthUser(): Promise<boolean> {
  const record = await db.meta.get(LAST_USER_ID_KEY);
  return typeof record?.value === 'string' && record.value !== '';
}

export async function forgetAuthUser(): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await db.meta.put({ key: SIGNED_OUT_KEY, value: true });
    await db.meta.delete(LAST_USER_ID_KEY);
  });
}

export async function allowAuthUser(): Promise<void> {
  await db.meta.delete(SIGNED_OUT_KEY);
}
