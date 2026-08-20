import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

import { errorResponse, json, readJson } from '../lib/http.js';
import { FEEDBACK_RATE_LIMIT } from '../lib/rateLimit.js';
import { enforceRateLimit } from '../lib/rateLimitHttp.js';
import { FEEDBACK_LABELS, issueBody, issueTitle, validateFeedback } from '../lib/feedbackIssue.js';

/**
 * Feedback from inside the app, filed as a GitHub issue (#196).
 *
 * Filing straight into the backlog is the whole point of the design. A private
 * store plus an admin screen would keep the words out of public view at the
 * price of a review surface that has to be built, secured and then *remembered*
 * — and the failure mode of a queue nobody remembers is silence that looks
 * identical to being ignored. An issue lands where the backlog already lives.
 *
 * Everything about this endpoint is user-initiated. There is no crash beacon
 * and no background reporting, because `SECURITY.md` promises nothing leaves
 * the device unprompted, and a promise with an exception in the code is just an
 * untrue sentence.
 */

export function githubConfig(): { token: string; repo: string } | null {
  const token = process.env['GITHUB_FEEDBACK_TOKEN'];
  const repo = process.env['GITHUB_FEEDBACK_REPO'];
  if (!token || !repo) return null;
  return { token, repo };
}

interface CreatedIssue {
  html_url?: unknown;
  number?: unknown;
}

async function createIssue(
  config: { token: string; repo: string },
  title: string,
  body: string,
): Promise<{ url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${config.repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'coffee-bean-tracker-feedback',
    },
    body: JSON.stringify({ title, body, labels: FEEDBACK_LABELS }),
  });

  if (!res.ok) {
    throw new Error(`GitHub responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const created = (await res.json()) as CreatedIssue;
  if (typeof created.html_url !== 'string' || typeof created.number !== 'number') {
    throw new Error('GitHub accepted the issue but did not describe it');
  }
  return { url: created.html_url, number: created.number };
}

app.http('feedback', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'feedback',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const validation = validateFeedback(await readJson<unknown>(req));
      if (!validation.ok) return json(400, { error: validation.error });

      const limited = enforceRateLimit(req, ctx, {
        name: 'feedback',
        config: FEEDBACK_RATE_LIMIT,
        message: 'That is a lot of feedback at once. Try again in a few minutes.',
      });
      if (limited) return limited;

      const config = githubConfig();
      if (!config) {
        // 503 with a way out, not a fake success. Silently accepting a message
        // that goes nowhere is the exact failure this feature exists to fix.
        ctx.warn('feedback endpoint is not configured');
        return json(503, {
          error: 'Feedback is not set up on this deployment yet.',
          fallbackUrl: 'https://github.com/saquibrashid/agentic-coffee-tracker/issues/new',
        });
      }

      const created = await createIssue(
        config,
        issueTitle(validation.value.message, validation.value.category),
        issueBody(validation.value),
      );

      // Length and category only. Logging the message would put user-authored
      // text into Application Insights, which is a second copy in a place
      // nobody was told about.
      ctx.log('feedback filed', {
        issue: created.number,
        category: validation.value.category ?? 'none',
        length: validation.value.message.length,
      });

      return json(201, created);
    } catch (err) {
      return errorResponse(ctx, 502, 'Could not file that feedback', err);
    }
  },
});
