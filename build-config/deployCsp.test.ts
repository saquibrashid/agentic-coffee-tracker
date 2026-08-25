import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCsp } from './csp';

/**
 * Guards the link between what the infrastructure provisions and what the
 * browser is permitted to reach.
 *
 * Photo bytes never travel through the BFF. The client asks for a
 * user-delegation SAS and then reads and writes
 * `https://<account>.blob.core.windows.net` directly, which is a *different
 * origin* from the app — so the account name has to be baked into `connect-src`
 * at build time or the browser refuses every one of those requests.
 *
 * It was not baked in. `deploy.yml` exported `VITE_API_BASE_URL` and
 * `VITE_AUTH_ENABLED` for the build and omitted the photo account, so
 * production shipped `connect-src 'self'`. Every photo upload and download was
 * blocked by the policy, and a CSP-blocked `fetch` rejects with a `TypeError` —
 * exactly what a device with no network produces. The sync engine classified it
 * as "offline" and discarded the message, so a device could sit for days
 * reporting a connection problem it did not have, with photos in its outbox
 * blocking every other change queued behind them.
 *
 * Nothing else could have caught it: the policy is correct, the infrastructure
 * output is correct, and the build reads the right variable. Only the one line
 * carrying the value between them was missing, which is why the assertion is on
 * the workflow rather than on any of the pieces it joins.
 */
const DEPLOY_WORKFLOW = join(process.cwd(), '.github', 'workflows', 'deploy.yml');

const PHOTO_ACCOUNT_VAR = 'AZURE_PHOTO_STORAGE_ACCOUNT_NAME';

describe('the deployed content security policy', () => {
  it('names the blob storage host when there is a photo account', () => {
    expect(buildCsp({ scriptHashes: ['sha256-x'], photoStorageAccount: 'stphoto123' })).toContain(
      'https://stphoto123.blob.core.windows.net',
    );
  });

  it('passes the provisioned photo account into the build', () => {
    // Read from the azd environment, not hard-coded: the account name carries a
    // per-environment token, so a literal would be wrong everywhere except the
    // one deployment it was copied from.
    const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');

    expect(workflow).toMatch(
      new RegExp(`${PHOTO_ACCOUNT_VAR}=\\$\\(azd env get-value ${PHOTO_ACCOUNT_VAR}`),
    );
  });

  it('exports it, so the build step can actually see it', () => {
    // Assigning without exporting is the silent version of this bug: the
    // workflow reads correctly, the build reads nothing, and the only symptom
    // is a header nobody inspects.
    const workflow = readFileSync(DEPLOY_WORKFLOW, 'utf8');
    const exportLine = workflow
      .split('\n')
      .find((line) => line.trimStart().startsWith('export ') && line.includes(PHOTO_ACCOUNT_VAR));

    expect(exportLine).toBeDefined();
  });
});
