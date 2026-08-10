/**
 * Cosmos access for the sync endpoints.
 *
 * Authentication is exclusively AAD via the Function App's user-assigned
 * managed identity — the account is provisioned with `disableLocalAuth: true`,
 * so there is no key to leak and none in app settings. The data-plane role
 * assignment lives in `infra/resources.bicep`.
 *
 * Everything here is scoped to one logical partition (`/userId`). That is what
 * makes the transactional batch in `push` possible; see `specs/sync.md` ->
 * The `seq` cursor.
 */
import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { requireEnv } from './http.js';

export type SyncRecordType = 'bean' | 'rating' | 'photo';

export interface SyncDocument {
  /** `${type}:${recordId}` — unique within the partition. */
  id: string;
  userId: string;
  type: SyncRecordType;
  recordId: string;
  /** Server-assigned, strictly increasing per user. */
  seq: number;
  /** ISO 8601, copied from the record. The LWW clock. */
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  /** Origin device, for diagnostics only. Never used for a decision. */
  deviceId: string;
  /** The full record minus blobs; null when deleted. */
  payload: unknown;
}

export interface CursorDocument {
  id: 'cursor';
  userId: string;
  /** Highest seq assigned so far. */
  seq: number;
}

export const CURSOR_ID = 'cursor';

/**
 * Cached across invocations. Both the client and the credential hold token and
 * connection state that is expensive to rebuild, and a Functions worker handles
 * many requests — reconstructing per request would add a token fetch to the
 * critical path of every sync cycle.
 */
let container: Container | undefined;

export function getSyncContainer(): Container {
  if (container) return container;

  const client = new CosmosClient({
    endpoint: requireEnv('COSMOS_ENDPOINT'),
    aadCredentials: new DefaultAzureCredential(),
  });
  container = client
    .database(requireEnv('COSMOS_DATABASE'))
    .container(requireEnv('COSMOS_CONTAINER'));
  return container;
}

export function documentId(type: SyncRecordType, recordId: string): string {
  return `${type}:${recordId}`;
}

/**
 * Deletes every document in the user's partition, cursor included.
 *
 * Returns the number removed. Not transactional, and deliberately so: a
 * partition can hold far more than the 100-operation batch limit, so this is a
 * loop that can be interrupted. Interruption is safe — a partial delete leaves
 * a smaller partition and the caller retries — whereas refusing to delete
 * anything until it can all be done at once would mean a large library could
 * never be deleted at all.
 *
 * The cursor goes last. Deleting it first would let a concurrent push
 * re-create it at seq 0 and start re-numbering records this call is still in
 * the middle of removing.
 */
export async function deleteUserData(userId: string): Promise<number> {
  const container = getSyncContainer();
  let deleted = 0;

  for (;;) {
    const { resources } = await container.items
      .query<{ id: string }>(
        {
          query: 'SELECT TOP 200 c.id FROM c WHERE c.userId = @userId AND c.id != @cursorId',
          parameters: [
            { name: '@userId', value: userId },
            { name: '@cursorId', value: CURSOR_ID },
          ],
        },
        { partitionKey: userId },
      )
      .fetchAll();

    if (resources.length === 0) break;

    for (const { id } of resources) {
      await container.item(id, userId).delete();
      deleted += 1;
    }
  }

  try {
    await container.item(CURSOR_ID, userId).delete();
    deleted += 1;
  } catch (err) {
    // A user who never pushed has no cursor. Nothing to delete is success.
    if ((err as { code?: number }).code !== 404) throw err;
  }

  return deleted;
}

/**
 * Reads the user's cursor, along with the ETag needed to guard its replace.
 *
 * A user who has never pushed has no cursor document. That is not an error —
 * it is seq 0 and an empty quota — but the absent ETag matters: the batch must
 * then *create* the cursor rather than replace it, and two devices racing to
 * create it are resolved by the create failing for the loser.
 */
export async function readCursor(
  userId: string,
): Promise<{ cursor: CursorDocument; etag: string | undefined }> {
  const response = await getSyncContainer().item(CURSOR_ID, userId).read<CursorDocument>();

  if (!response.resource) {
    return { cursor: { id: CURSOR_ID, userId, seq: 0 }, etag: undefined };
  }
  return { cursor: response.resource, etag: response.etag };
}
