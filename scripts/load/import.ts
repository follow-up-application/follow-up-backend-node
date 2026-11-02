import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import autocannon, { type AutocannonInstance, type AutocannonResult } from 'autocannon';

const baseUrl = (process.env.LOAD_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const csvPath = process.env.LOAD_CSV ? resolve(process.env.LOAD_CSV) : null;
const connections = Number(process.env.LOAD_CONNECTIONS ?? 20);
const warmupSeconds = Number(process.env.LOAD_WARMUP_SECONDS ?? 5);
const cooldownSeconds = Number(process.env.LOAD_COOLDOWN_SECONDS ?? 5);
const baselineSeconds = Number(process.env.LOAD_DURATION ?? 30);
const maxSeconds = Number(process.env.LOAD_MAX_SECONDS ?? 900);
const username = process.env.LOAD_USERNAME ?? 'admin';
const password = process.env.LOAD_PASSWORD ?? 'Admin1234!';
const output = resolve(
  process.env.LOAD_OUTPUT ?? `tmp/mediciones/${csvPath ? 'import' : 'baseline'}-${Date.now()}.json`,
);

interface MetricsSample {
  at: string;
  event_loop: {
    samples: number;
    max_ms: number | null;
    p99_ms: number | null;
  } | null;
  memory: { rss: number; heapUsed: number };
  db_pool: { total: number; idle: number; waiting: number; max: number };
}

interface ImportJobView {
  id: string;
  estado: string;
  total_rows: number;
  processed_rows: number;
  valid_rows: number;
  error_rows: number;
  error_code: string | null;
  created_at: string;
  finished_at: string | null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? 'GET'} ${path} respondió ${response.status}: ${body.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function startLoad(): { instance: AutocannonInstance; result: Promise<AutocannonResult> } {
  let resolveResult!: (value: AutocannonResult) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<AutocannonResult>((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });
  const instance = autocannon(
    { url: `${baseUrl}/health`, connections, duration: 3600 },
    (error, loadResult) => {
      if (error) rejectResult(error);
      else resolveResult(loadResult);
    },
  );
  return { instance, result };
}

async function sampleMetrics(token: string): Promise<MetricsSample> {
  const metrics = await request<{
    event_loop: MetricsSample['event_loop'];
    memory: { rss: number; heapUsed: number };
    db_pool: MetricsSample['db_pool'];
  }>('/internal/metrics', { headers: authHeaders(token) });
  return {
    at: new Date().toISOString(),
    event_loop: metrics.event_loop,
    memory: { rss: metrics.memory.rss, heapUsed: metrics.memory.heapUsed },
    db_pool: metrics.db_pool,
  };
}

async function collectSamples(
  token: string,
  samples: MetricsSample[],
  running: () => boolean,
): Promise<void> {
  while (running()) {
    try {
      samples.push(await sampleMetrics(token));
    } catch {
      // La muestra se pierde; el escenario continúa.
    }
    await sleep(1000);
  }
}

function peak(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : null;
}

async function run(): Promise<void> {
  const login = await request<{ access_token: string }>('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const token = login.access_token;

  await fetch(`${baseUrl}/internal/metrics/reset`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  const samples: MetricsSample[] = [];
  let sampling = true;
  const sampler = collectSamples(token, samples, () => sampling);
  const load = startLoad();

  let job: ImportJobView | null = null;
  let importSeconds: number | null = null;
  const startedAt = Date.now();

  try {
    await sleep(warmupSeconds * 1000);

    if (csvPath) {
      const content = await readFile(csvPath);
      const accepted = await request<ImportJobView>('/api/v1/imports/alumnos', {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Content-Type': 'text/csv',
          'Idempotency-Key': randomUUID(),
        },
        body: content,
      });

      const deadline = Date.now() + maxSeconds * 1000;
      let current = accepted;
      while (current.estado !== 'completada' && current.estado !== 'fallida') {
        if (Date.now() > deadline) {
          throw new Error(`La importación ${accepted.id} superó ${maxSeconds} s.`);
        }
        await sleep(1000);
        current = await request<ImportJobView>(`/api/v1/imports/${accepted.id}`, {
          headers: authHeaders(token),
        });
      }
      job = current;
      importSeconds = (Date.now() - startedAt) / 1000;
      await sleep(cooldownSeconds * 1000);
    } else {
      await sleep(baselineSeconds * 1000);
    }
  } finally {
    sampling = false;
    await sampler;
    load.instance.stop();
  }

  const loadResult = await load.result;
  const summary = {
    scenario: csvPath ? 'import' : 'baseline',
    base_url: baseUrl,
    csv: csvPath,
    connections,
    warmup_seconds: warmupSeconds,
    cooldown_seconds: cooldownSeconds,
    started_at: new Date(startedAt).toISOString(),
    load: {
      requests: loadResult.requests.total,
      rps: loadResult.requests.average,
      latency_ms: {
        p50: loadResult.latency.p50,
        p95: loadResult.latency.p95,
        p99: loadResult.latency.p99,
        max: loadResult.latency.max,
      },
      errors: loadResult.errors,
      timeouts: loadResult.timeouts,
      non2xx: loadResult.non2xx,
    },
    event_loop_lag_ms: {
      max: peak(samples.map((sample) => sample.event_loop?.max_ms)),
      p99: peak(samples.map((sample) => sample.event_loop?.p99_ms)),
    },
    memory_peak_bytes: {
      rss: peak(samples.map((sample) => sample.memory.rss)),
      heap_used: peak(samples.map((sample) => sample.memory.heapUsed)),
    },
    db_pool_peak: {
      waiting: peak(samples.map((sample) => sample.db_pool.waiting)),
      total: peak(samples.map((sample) => sample.db_pool.total)),
    },
    import: job
      ? {
          id: job.id,
          estado: job.estado,
          total_rows: job.total_rows,
          valid_rows: job.valid_rows,
          error_rows: job.error_rows,
          error_code: job.error_code,
          duration_seconds: importSeconds,
          rows_per_second:
            importSeconds && importSeconds > 0 ? Math.round((job.total_rows / importSeconds) * 100) / 100 : null,
        }
      : null,
    samples,
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...summary, samples: `${samples.length} muestras` }, null, 2)}\n`);
  process.stdout.write(`Resultado escrito en ${output}\n`);
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
