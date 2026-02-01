/**
 * Cold start benchmark runner
 * Measures time from process spawn to first successful response
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { type Runtime, ZIGTTP_SERVER_BIN, projectDir } from "./runtime.ts";
import { ensurePortFree, getDefaultPort, isPortFree, waitForServer } from "./ports.ts";
import { saveResult } from "./results.ts";

export type ColdStartConfig = {
  iterations: number;
};

export type ColdStartMetrics = {
  mean_us: number;
  median_us: number;
  p95_us: number;
  p99_us: number;
  min_us: number;
  max_us: number;
  samples: number;
};

export type ColdStartResult = {
  type: "cold_start";
  runtime: string;
  iterations: number;
  metrics: ColdStartMetrics;
  timestamp: string;
};

const DEFAULT_CONFIG: ColdStartConfig = {
  iterations: 100,
};

/**
 * Measure a single cold start iteration
 * Returns time in microseconds, or -1 on failure
 */
async function measureColdStart(
  runtime: Runtime,
  port: number,
  handlerPath: string
): Promise<number> {
  const startUs = performance.now() * 1000;

  let cmd: Deno.Command;

  if (runtime === "deno") {
    cmd = new Deno.Command("deno", {
      args: ["run", "--allow-net", "--allow-env", handlerPath],
      env: { ...Deno.env.toObject(), PORT: String(port) },
      stdout: "null",
      stderr: "null",
    });
  } else {
    // Use embedded bytecode if available (no handler path = embedded mode)
    // Otherwise use runtime parsing (handler path overrides embedded)
    const useEmbedded = Deno.env.get("ZIGTTP_USE_EMBEDDED") === "true";
    const args = useEmbedded
      ? ["-p", String(port), "-q"]
      : ["-p", String(port), "-q", handlerPath];

    cmd = new Deno.Command(ZIGTTP_SERVER_BIN, {
      args,
      stdout: "null",
      stderr: "null",
    });
  }

  const process = cmd.spawn();

  // Wait for first successful response
  const ready = await waitForServer(port, "/api/health", 10000);
  const endUs = performance.now() * 1000;

  // Kill the process
  try {
    process.kill("SIGKILL");
    await process.status;
  } catch {
    // Process may have already exited
  }

  // Wait for port to be free again
  let attempts = 0;
  while (attempts < 50 && !(await isPortFree(port))) {
    await new Promise((r) => setTimeout(r, 100));
    attempts++;
  }

  if (!ready) {
    return -1;
  }

  return Math.round(endUs - startUs);
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Run cold start benchmarks for a single runtime
 */
export async function runColdStartBenchmarks(
  runtime: Runtime,
  resultsDir: string,
  config: Partial<ColdStartConfig> = {}
): Promise<ColdStartResult | null> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const iterations = fullConfig.iterations;

  console.log(`=== Cold Start: ${runtime} (${iterations} iterations) ===`);

  // Get a free port
  const preferredPort = getDefaultPort(runtime);
  const { port } = await ensurePortFree(preferredPort);

  // Get handler path
  const handlerPath = runtime === "deno"
    ? join(projectDir, "handlers", "deno", "server.ts")
    : join(projectDir, "handlers", "zigttp", "handler.js");

  const samples: number[] = [];

  for (let i = 1; i <= iterations; i++) {
    const us = await measureColdStart(runtime, port, handlerPath);

    if (us > 0) {
      samples.push(us);
    }

    if (i % 10 === 0) {
      console.log(`  Completed ${i}/${iterations}`);
    }
  }

  if (samples.length === 0) {
    console.error(`  No successful samples for ${runtime}`);
    return null;
  }

  // Calculate statistics
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round(sum / sorted.length);
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const metrics: ColdStartMetrics = {
    mean_us: mean,
    median_us: median,
    p95_us: p95,
    p99_us: p99,
    min_us: min,
    max_us: max,
    samples: sorted.length,
  };

  console.log(`  Results: mean=${mean}us, median=${median}us, p99=${p99}us`);
  console.log("");

  const result: ColdStartResult = {
    type: "cold_start",
    runtime,
    iterations,
    metrics,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  // Save result
  const filename = `coldstart_${runtime}.json`;
  await saveResult(resultsDir, filename, result);

  return result;
}

/**
 * Run cold start benchmarks for all specified runtimes
 */
export async function runAllColdStartBenchmarks(
  runtimes: Runtime[],
  resultsDir: string,
  config: Partial<ColdStartConfig> = {}
): Promise<Map<Runtime, ColdStartResult | null>> {
  const results = new Map<Runtime, ColdStartResult | null>();

  console.log("Cold Start Benchmark Suite");
  console.log(`Results: ${resultsDir}`);
  console.log("");

  for (let i = 0; i < runtimes.length; i++) {
    const runtime = runtimes[i];
    const result = await runColdStartBenchmarks(runtime, resultsDir, config);
    results.set(runtime, result);

    // Cooldown between runtimes
    if (i < runtimes.length - 1) {
      console.log("Cooldown: 2s before next runtime...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("=== Cold Start Benchmarks Complete ===");
  return results;
}
