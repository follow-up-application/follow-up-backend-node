declare module 'autocannon' {
  export interface AutocannonOptions {
    url: string;
    connections?: number;
    duration?: number;
    pipelining?: number;
    method?: string;
  }

  export interface AutocannonResult {
    duration: number;
    connections: number;
    requests: { average: number; total: number };
    latency: { p50: number; p95: number; p99: number; max: number };
    errors: number;
    timeouts: number;
    non2xx: number;
  }

  export interface AutocannonInstance {
    stop(): void;
  }

  export default function autocannon(options: AutocannonOptions): Promise<AutocannonResult>;
  export default function autocannon(
    options: AutocannonOptions,
    callback: (error: Error | null, result: AutocannonResult) => void,
  ): AutocannonInstance;
}
