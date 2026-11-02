import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

export interface EventLoopLagSnapshot {
  samples: number;
  min_ms: number | null;
  max_ms: number | null;
  mean_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

let histogram: IntervalHistogram | null = null;

function nanosecondsToMilliseconds(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round((value / 1_000_000) * 100) / 100;
}

export function startEventLoopMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
}

export function resetEventLoopMonitor(): void {
  histogram?.reset();
}

export function eventLoopLag(): EventLoopLagSnapshot | null {
  if (!histogram) return null;
  const samples = histogram.count;
  if (samples === 0) {
    return {
      samples: 0,
      min_ms: null,
      max_ms: null,
      mean_ms: null,
      p50_ms: null,
      p95_ms: null,
      p99_ms: null,
    };
  }
  return {
    samples,
    min_ms: nanosecondsToMilliseconds(histogram.min),
    max_ms: nanosecondsToMilliseconds(histogram.max),
    mean_ms: nanosecondsToMilliseconds(histogram.mean),
    p50_ms: nanosecondsToMilliseconds(histogram.percentile(50)),
    p95_ms: nanosecondsToMilliseconds(histogram.percentile(95)),
    p99_ms: nanosecondsToMilliseconds(histogram.percentile(99)),
  };
}
