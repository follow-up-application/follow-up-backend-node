import autocannon from 'autocannon';

const url = process.env.LOAD_URL ?? 'http://localhost:3000/health';
const connections = Number(process.env.LOAD_CONNECTIONS ?? 20);
const duration = Number(process.env.LOAD_DURATION ?? 10);

async function main(): Promise<void> {
  process.stdout.write(
    `Midiendo ${url} con ${connections} conexiones durante ${duration} s...\n`,
  );

  const result = await autocannon({ url, connections, duration });

  process.stdout.write(
    `${JSON.stringify(
      {
        url,
        connections: result.connections,
        duration: result.duration,
        requests: result.requests.total,
        rps: result.requests.average,
        latency_ms: {
          p50: result.latency.p50,
          p95: result.latency.p95,
          p99: result.latency.p99,
          max: result.latency.max,
        },
        errors: result.errors,
        timeouts: result.timeouts,
        non2xx: result.non2xx,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
