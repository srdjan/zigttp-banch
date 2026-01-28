/**
 * Microbenchmark runner for zigttp and Deno
 * Builds and executes JavaScript benchmark suite
 */

import { join, dirname, fromFileUrl } from "https://deno.land/std@0.220.0/path/mod.ts";
import { type Runtime, ZIGTTP_BENCH_BIN, projectDir } from "./runtime.ts";
import { saveResult } from "./results.ts";

const microbenchDir = join(projectDir, "microbench");

export type MicrobenchConfig = {
  filter?: string;
  warmupIterations?: number;
  measuredIterations?: number;
  httpHandlerHeavyIterations?: number;
};

export type BenchmarkData = {
  name: string;
  warmup_iterations: number;
  warmup_ms: number;
  measured_iterations: number;
  inner_iterations: number;
  batch_size: number;
  total_ms: number;
  mean_ms: number;
  median_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
  ns_per_op: number;
  ops_per_sec: number;
  clock_source: string;
  clock_resolution_ms: number;
  target_sample_ms: number;
  runtime?: string;
};

export type MicrobenchResult = {
  type: "microbenchmark";
  runtime: string;
  benchmarks: Record<string, BenchmarkData>;
  timestamp: string;
};

/**
 * Build the concatenated suite script from runner.js + benchmarks/*.js + suite.js
 */
async function buildSuiteScript(config: MicrobenchConfig): Promise<string> {
  const files: string[] = [join(microbenchDir, "runner.js")];

  // Add all benchmark files sorted alphabetically
  const benchmarkDir = join(microbenchDir, "benchmarks");
  const benchmarkFiles: string[] = [];

  for await (const entry of Deno.readDir(benchmarkDir)) {
    if (entry.isFile && entry.name.endsWith(".js")) {
      benchmarkFiles.push(join(benchmarkDir, entry.name));
    }
  }

  benchmarkFiles.sort();
  files.push(...benchmarkFiles);
  files.push(join(microbenchDir, "suite.js"));

  // Build script with config headers
  let script = "";

  if (config.filter) {
    script += `let __benchFilter = ${JSON.stringify(config.filter)};\n`;
  }

  if (config.httpHandlerHeavyIterations !== undefined) {
    script += `let __httpHandlerHeavyIterations = ${config.httpHandlerHeavyIterations};\n`;
  }

  const benchConfigParts: string[] = [];
  if (config.warmupIterations !== undefined) {
    benchConfigParts.push(`warmupIterations: ${config.warmupIterations}`);
  }
  if (config.measuredIterations !== undefined) {
    benchConfigParts.push(`measuredIterations: ${config.measuredIterations}`);
  }
  if (benchConfigParts.length > 0) {
    script += `let __benchConfig = { ${benchConfigParts.join(", ")} };\n`;
  }

  // Concatenate all source files
  for (const file of files) {
    const content = await Deno.readTextFile(file);
    script += content + "\n";
  }

  return script;
}

/**
 * Run microbenchmarks with Deno
 */
async function runDenoMicrobench(
  suiteScript: string,
  resultsDir: string
): Promise<MicrobenchResult | null> {
  console.log("=== Microbenchmarks: deno ===");

  // Write suite to temp file
  const suitePath = join(resultsDir, "microbench_suite.js");
  await Deno.writeTextFile(suitePath, suiteScript);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--quiet", suitePath],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();

  if (code !== 0) {
    console.error("  Failed to run Deno benchmarks");
    console.error(new TextDecoder().decode(stderr));
    return null;
  }

  const output = new TextDecoder().decode(stdout).trim();
  if (!output) {
    console.error("  No output from Deno benchmarks");
    return null;
  }

  try {
    const benchmarks = JSON.parse(output) as Record<string, BenchmarkData>;

    // Print summary
    for (const [name, data] of Object.entries(benchmarks)) {
      const opsPerSec = data.ops_per_sec ?? 0;
      console.log(`  ${name}: ${Math.floor(opsPerSec).toLocaleString()} ops/sec`);
    }

    const result: MicrobenchResult = {
      type: "microbenchmark",
      runtime: "deno",
      benchmarks,
      timestamp: new Date().toISOString(),
    };

    await saveResult(resultsDir, "microbench_deno.json", result);
    console.log("");
    return result;
  } catch (e) {
    console.error("  Failed to parse benchmark output:", e);
    console.log("  Raw output:", output.slice(0, 500));
    return null;
  }
}

/**
 * Run microbenchmarks with zigttp
 */
async function runZigttpMicrobench(
  suiteScript: string,
  resultsDir: string
): Promise<MicrobenchResult | null> {
  console.log("=== Microbenchmarks: zigttp ===");

  // Check if zigttp-bench binary exists
  try {
    await Deno.stat(ZIGTTP_BENCH_BIN);
  } catch {
    console.log("  zigttp-bench not built, skipping (run: cd ../zigttp && zig build bench)");
    console.log("");
    return null;
  }

  // Write suite to temp file
  const suitePath = join(resultsDir, "microbench_suite.js");
  await Deno.writeTextFile(suitePath, suiteScript);

  const cmd = new Deno.Command(ZIGTTP_BENCH_BIN, {
    args: ["--script", suitePath],
    stdout: "piped",
    stderr: "piped",
    env: {
      ...Deno.env.toObject(),
      // Disable JIT due to known caching bug with high-iteration benchmarks
      ZTS_JIT_THRESHOLD: "999999",
    },
  });

  const { code, stdout, stderr } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  if (code !== 0 && !output) {
    console.error("  Failed to run zigttp-bench");
    console.error(new TextDecoder().decode(stderr));
    console.log("");
    return null;
  }

  if (!output) {
    console.error("  No output from zigttp-bench");
    console.log("");
    return null;
  }

  try {
    const benchmarks = JSON.parse(output) as Record<string, BenchmarkData>;

    // Print summary
    for (const [name, data] of Object.entries(benchmarks)) {
      const opsPerSec = data.ops_per_sec ?? 0;
      console.log(`  ${name}: ${Math.floor(opsPerSec).toLocaleString()} ops/sec`);
    }

    const result: MicrobenchResult = {
      type: "microbenchmark",
      runtime: "zigttp",
      benchmarks,
      timestamp: new Date().toISOString(),
    };

    await saveResult(resultsDir, "microbench_zigttp.json", result);
    console.log("");
    return result;
  } catch (e) {
    console.error("  Failed to parse benchmark output:", e);
    console.log("  Raw output:", output.slice(0, 500));
    return null;
  }
}

/**
 * Run microbenchmarks for a single runtime
 */
export async function runMicrobenchmarks(
  runtime: Runtime,
  resultsDir: string,
  config: MicrobenchConfig = {}
): Promise<MicrobenchResult | null> {
  const suiteScript = await buildSuiteScript(config);

  if (runtime === "deno") {
    return await runDenoMicrobench(suiteScript, resultsDir);
  } else {
    return await runZigttpMicrobench(suiteScript, resultsDir);
  }
}

/**
 * Run microbenchmarks for all specified runtimes
 */
export async function runAllMicrobenchmarks(
  runtimes: Runtime[],
  resultsDir: string,
  config: MicrobenchConfig = {}
): Promise<Map<Runtime, MicrobenchResult | null>> {
  const results = new Map<Runtime, MicrobenchResult | null>();

  console.log("Microbenchmark Suite");
  console.log(`Results: ${resultsDir}`);
  if (config.filter) {
    console.log(`Filter: ${config.filter}`);
  }
  console.log("");

  const suiteScript = await buildSuiteScript(config);

  for (const runtime of runtimes) {
    const result = runtime === "deno"
      ? await runDenoMicrobench(suiteScript, resultsDir)
      : await runZigttpMicrobench(suiteScript, resultsDir);
    results.set(runtime, result);
  }

  console.log("=== Microbenchmarks Complete ===");
  return results;
}

/**
 * Format ops/sec for display in table
 */
export function formatOpsPerSec(ops: number): string {
  if (ops >= 1_000_000_000) {
    return `${(ops / 1_000_000_000).toFixed(2)}B`;
  } else if (ops >= 1_000_000) {
    return `${(ops / 1_000_000).toFixed(2)}M`;
  } else if (ops >= 1_000) {
    return `${(ops / 1_000).toFixed(2)}K`;
  }
  return ops.toFixed(0);
}
