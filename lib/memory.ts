/**
 * Memory profiling module
 * Measures baseline RSS and RSS under load
 */

import { type Runtime } from "./runtime.ts";
import { ensurePortFree, getDefaultPort } from "./ports.ts";
import { type ServerHandle, startServer, stopServer } from "./server.ts";
import { saveResult } from "./results.ts";
import { computeStats, isoTimestamp, sleep } from "./utils.ts";

export type MemoryConfig = {
  loadDurationSecs: number;
  sampleIntervalMs: number;
  connections: number;
};

export type MemoryMetrics = {
  baseline_kb: number;
  peak_kb: number;
  avg_kb: number;
  min_kb: number;
  samples: number;
  samples_raw: number[];
};

export type MemoryResult = {
  type: "memory_profile";
  runtime: string;
  metrics: MemoryMetrics;
  timestamp: string;
};

const DEFAULT_CONFIG: MemoryConfig = {
  loadDurationSecs: 30,
  sampleIntervalMs: 100,
  connections: 10,
};

/**
 * Get RSS (resident set size) in KB for a process
 */
async function getRssKb(pid: number): Promise<number> {
  try {
    const cmd = new Deno.Command("ps", {
      args: ["-o", "rss=", "-p", String(pid)],
      stdout: "piped",
      stderr: "null",
    });

    const { code, stdout } = await cmd.output();
    if (code !== 0) {
      return 0;
    }

    const output = new TextDecoder().decode(stdout).trim();
    const rss = parseInt(output, 10);
    return isNaN(rss) ? 0 : rss;
  } catch {
    return 0;
  }
}

/**
 * Sample RSS over a duration while load is running
 */
async function sampleRss(
  pid: number,
  durationMs: number,
  intervalMs: number,
): Promise<number[]> {
  const samples: number[] = [];
  const startTime = Date.now();
  const endTime = startTime + durationMs;

  while (Date.now() < endTime) {
    const rss = await getRssKb(pid);
    if (rss > 0) {
      samples.push(rss);
    }
    await sleep(intervalMs);
  }

  return samples;
}

/**
 * Run load generator in background
 */
function runLoadGenerator(
  port: number,
  connections: number,
  durationSecs: number,
): Deno.ChildProcess {
  const cmd = new Deno.Command("hey", {
    args: [
      "-c",
      String(connections),
      "-z",
      `${durationSecs}s`,
      `http://127.0.0.1:${port}/api/health`,
    ],
    stdout: "null",
    stderr: "null",
  });

  return cmd.spawn();
}

/**
 * Run memory profiling for a single runtime
 */
export async function runMemoryProfile(
  runtime: Runtime,
  resultsDir: string,
  config: Partial<MemoryConfig> = {},
): Promise<MemoryResult | null> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`=== Memory Profile: ${runtime} ===`);

  // Get a free port
  const preferredPort = getDefaultPort(runtime);
  const { port } = await ensurePortFree(preferredPort);

  // Start server
  let handle: ServerHandle;
  try {
    handle = await startServer(runtime, port);
  } catch (e) {
    console.error(`  Failed to start ${runtime} server: ${e}`);
    return null;
  }

  try {
    // Measure baseline RSS (before load)
    await sleep(1000); // Wait for server to stabilize
    const baselineKb = await getRssKb(handle.pid);
    console.log(`  Baseline RSS: ${baselineKb} KB`);

    if (baselineKb === 0) {
      console.error("  Failed to get baseline RSS");
      return null;
    }

    // Start load generator
    const loadProcess = runLoadGenerator(
      port,
      fullConfig.connections,
      fullConfig.loadDurationSecs,
    );

    // Sample RSS during load
    const samples = await sampleRss(
      handle.pid,
      fullConfig.loadDurationSecs * 1000,
      fullConfig.sampleIntervalMs,
    );

    // Wait for load generator to finish
    const loadStatus = await loadProcess.status;
    if (loadStatus.code !== 0) {
      console.error(`  Load generator exited with code ${loadStatus.code}`);
    }

    if (samples.length === 0) {
      console.error("  No RSS samples collected");
      return null;
    }

    // Calculate statistics
    const stats = computeStats(samples);

    console.log(`  Peak RSS: ${stats.max} KB`);
    console.log(`  Avg RSS: ${stats.mean} KB`);
    console.log("");

    const metrics: MemoryMetrics = {
      baseline_kb: baselineKb,
      peak_kb: stats.max,
      avg_kb: stats.mean,
      min_kb: stats.min,
      samples: samples.length,
      samples_raw: samples,
    };

    const result: MemoryResult = {
      type: "memory_profile",
      runtime,
      metrics,
      timestamp: isoTimestamp(),
    };

    // Save result
    const filename = `memory_${runtime}.json`;
    await saveResult(resultsDir, filename, result);

    return result;
  } finally {
    await stopServer(handle);
  }
}

/**
 * Run memory profiling for all specified runtimes
 */
export async function runAllMemoryProfiles(
  runtimes: Runtime[],
  resultsDir: string,
  config: Partial<MemoryConfig> = {},
): Promise<Map<Runtime, MemoryResult | null>> {
  const results = new Map<Runtime, MemoryResult | null>();

  console.log("Memory Profiling Suite");
  console.log(`Results: ${resultsDir}`);
  console.log("");

  for (let i = 0; i < runtimes.length; i++) {
    const runtime = runtimes[i];
    const result = await runMemoryProfile(runtime, resultsDir, config);
    results.set(runtime, result);

    // Cooldown between runtimes
    if (i < runtimes.length - 1) {
      console.log("Cooldown: 2s before next runtime...");
      await sleep(2000);
    }
  }

  console.log("=== Memory Profiling Complete ===");
  return results;
}
