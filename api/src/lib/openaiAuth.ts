/**
 * How the BFF proves who it is to Azure OpenAI.
 *
 * Two ways, and which one is used is decided by whether a key was configured
 * rather than by a switch, because a switch can disagree with reality.
 *
 * - **Managed identity** (`Authorization: Bearer`). The Function App already
 *   carries a user-assigned identity for Cosmos, Blob and Key Vault, and
 *   `AZURE_CLIENT_ID` is already set for it, so `DefaultAzureCredential`
 *   resolves to that identity with no extra configuration. This is the
 *   provisioned path: no secret exists to leak, rotate, or forget to rotate.
 * - **API key** (`api-key`). Kept for the documented bring-your-own-resource
 *   case, where the operator supplies `openAiKey` for an account this
 *   deployment does not own and therefore cannot grant itself a role on. Also
 *   what local development uses.
 *
 * Deciding by presence means removing the key from configuration is the whole
 * migration; there is no second setting that could be left pointing the wrong
 * way, and a bring-your-own deployment keeps working untouched.
 *
 * See `specs/agentic-backend.md` §9 — this was the open question about whether
 * the Key Vault API keys were worth replacing independently of any agent work.
 */

import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

/**
 * The audience for every Azure AI Services data-plane call, Azure OpenAI
 * included. Note it is `cognitiveservices`, not a per-account URL: tokens are
 * issued for the service, and it is the role assignment on the account that
 * decides which accounts they open.
 */
export const OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

/**
 * Refresh this long before the token actually dies.
 *
 * A token that expires mid-flight fails the request rather than retrying, and
 * these calls can run for 60 seconds. Five minutes is comfortably longer than
 * the longest call any endpoint makes.
 */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

let credential: TokenCredential | undefined;
let cached: { token: string; expiresOnMs: number } | undefined;

/** Test seam. Passing a credential also clears the cached token. */
export function setCredentialForTesting(next: TokenCredential | undefined): void {
  credential = next;
  cached = undefined;
}

/**
 * A bearer token for Azure OpenAI, reused until it is close to expiring.
 *
 * Caching matters more here than it looks. The identity endpoint is a network
 * call on the instance's local link, and enrichment can fire several model
 * calls per request; fetching a token for each would add a round-trip to every
 * one of them for a credential that is valid for the next 24 hours.
 */
export async function getAccessToken(now = Date.now()): Promise<string> {
  if (cached && cached.expiresOnMs - EXPIRY_MARGIN_MS > now) return cached.token;

  credential ??= new DefaultAzureCredential();
  const token = await credential.getToken(OPENAI_SCOPE);
  if (!token) throw new Error('Managed identity returned no token for Azure OpenAI');

  cached = { token: token.token, expiresOnMs: token.expiresOnTimestamp };
  return token.token;
}

/**
 * The auth header for a call, given whatever credentials are configured.
 *
 * Returns a fresh object each time rather than a shared one, so a caller
 * spreading it into a headers literal cannot mutate the next call's auth.
 */
export async function authHeaders(key: string | undefined): Promise<Record<string, string>> {
  if (key) return { 'api-key': key };
  return { Authorization: `Bearer ${await getAccessToken()}` };
}
