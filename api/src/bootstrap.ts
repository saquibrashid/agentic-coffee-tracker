/**
 * Starts Azure Monitor OpenTelemetry, once, before the functions load.
 *
 * Imported by `telemetry.ts`, so it runs as a side effect of loading any module
 * that creates a span. That is early enough: with auto-instrumentation off
 * there is nothing to monkey-patch before other libraries load, and the tracer
 * provider only has to be registered before the first span is *created*, which
 * happens at request time.
 *
 * It is deliberately not a second entry point in `package.json`'s `main` — the
 * Functions Node worker treats `main` as a single glob, not a list, and a
 * comma-separated value matches zero files and registers no functions at all.
 *
 * **Auto-instrumentation is deliberately all off.** The distro would otherwise
 * span every outbound HTTP call, which for this app means every page scrape and
 * every store search on every domain in the ladder — a large multiple of the
 * spans we actually want, billed per GB ingested. The AI paths are instrumented
 * by hand in `telemetry.ts` instead, which keeps the volume proportional to
 * what is being asked rather than to how hard the ladder worked. If richer
 * traces are wanted later, turning `http` back on is a one-line change and the
 * manual spans nest underneath it correctly.
 *
 * Existing behaviour is untouched: `host.json` keeps `telemetryMode` at its
 * default, so the host's own Application Insights logging and portal log
 * streaming work exactly as before. This adds traces alongside them.
 */

import { useAzureMonitor } from '@azure/monitor-opentelemetry';

let started = false;

/**
 * Idempotent, and silent when unconfigured.
 *
 * No connection string means local development and the test suite, where the
 * OTel API's default no-op tracer is exactly the right behaviour — spans are
 * still created at every call site, they just go nowhere.
 */
export function startTelemetry(): boolean {
  if (started) return true;
  const connectionString = process.env['APPLICATIONINSIGHTS_CONNECTION_STRING'];
  if (!connectionString) return false;
  // A developer with the production connection string in their environment
  // should not ship spans just by running the test suite.
  if (process.env['VITEST']) return false;

  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    // Traces are the point. The rest is either already covered by the host's
    // own telemetry or is volume we would be paying for twice.
    enableLiveMetrics: false,
    enableStandardMetrics: false,
    enablePerformanceCounters: false,
    instrumentationOptions: {
      http: { enabled: false },
      azureSdk: { enabled: false },
      console: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      postgreSql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
    },
  });

  started = true;
  // Worth one line in the log: whether traces are on is otherwise invisible
  // until you go looking for spans that were never emitted.
  console.log('telemetry: Azure Monitor OpenTelemetry started');
  return true;
}

startTelemetry();
