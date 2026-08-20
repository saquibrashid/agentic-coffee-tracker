import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the six-hour default.
 *
 * A step that hangs rather than fails does not stop on its own: an install step
 * once sat on the network for three and a half hours before anyone noticed, and
 * because `deploy.yml` queues runs behind one another, a hang there blocks every
 * later deploy for as long as it lasts (#240). Timeouts were added to every job,
 * but the durable risk is the *next* job someone adds without one, so this
 * asserts the property rather than the edit.
 *
 * Parsed by hand rather than with a YAML library: the shape being checked is two
 * levels deep in files this repo owns, and the alternative is a dependency that
 * exists solely for this test. The cost of that choice is a parser that could
 * silently stop matching and pass vacuously, so the test below pins the job
 * names it expects to find as well as the property it is checking.
 */
const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows');

interface Job {
  workflow: string;
  name: string;
  body: string[];
}

function readJobs(): Job[] {
  const jobs: Job[] = [];

  for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml'))) {
    const lines = readFileSync(join(WORKFLOW_DIR, file), 'utf8').split(/\r?\n/);
    const start = lines.findIndex((line) => line === 'jobs:');
    expect(start, `${file} has no top-level jobs: block`).toBeGreaterThanOrEqual(0);

    let current: Job | null = null;
    for (const line of lines.slice(start + 1)) {
      // A job header is the only thing at exactly two spaces of indent.
      const header = /^ {2}([\w-]+):\s*$/.exec(line);
      if (header) {
        current = { workflow: file, name: header[1]!, body: [] };
        jobs.push(current);
        continue;
      }
      // Anything back at column zero has left the jobs block entirely.
      if (line.trim() !== '' && !line.startsWith(' ')) break;
      current?.body.push(line);
    }
  }

  return jobs;
}

describe('workflow job timeouts', () => {
  const jobs = readJobs();

  it('finds every job the repository actually defines', () => {
    // Guards the guard: a parser that matched nothing would make the timeout
    // assertion below pass without checking anything.
    expect(jobs.map((job) => `${job.workflow}:${job.name}`).sort()).toEqual([
      'ci.yml:build-and-test',
      'ci.yml:docs',
      'ci.yml:infra',
      'ci.yml:lighthouse',
      'deploy.yml:deploy',
    ]);
  });

  it.each(jobs.map((job) => [`${job.workflow} / ${job.name}`, job] as const))(
    '%s cannot run past its own budget',
    (_label, job) => {
      const timeout = job.body
        .map((line) => /^ {4}timeout-minutes:\s*(\d+)\s*$/.exec(line))
        .find((match) => match !== null);

      expect(timeout, 'job has no timeout-minutes, so it inherits the 6-hour default').not.toBe(
        undefined,
      );
      // An upper bound as well as a lower one: a timeout long enough to be
      // indistinguishable from the default is not protection, it is decoration.
      expect(Number(timeout![1])).toBeGreaterThan(0);
      expect(Number(timeout![1])).toBeLessThanOrEqual(60);
    },
  );
});
