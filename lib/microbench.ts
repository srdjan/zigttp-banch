/**
 * Microbenchmark runner for zigttp and Deno
 * Builds and executes JavaScript benchmark suite
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { projectDir, type Runtime, ZIGTTP_BENCH_BIN } from "./runtime.ts";
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
async function buildSuiteScript(
  config: MicrobenchConfig,
  runtime: Runtime,
): Promise<string> {
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
    script +=
      `let __httpHandlerHeavyIterations = ${config.httpHandlerHeavyIterations};\n`;
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
    let content = await Deno.readTextFile(file);

    // For zigttp, remove the range polyfill section from runner.js
    // zigttp provides range() as a builtin and can't parse while loops
    if (runtime === "zigttp" && file.endsWith("runner.js")) {
      content = content.replace(
        /\/\/ range\(\) polyfill for Deno[\s\S]*?\/\/ end range\(\) polyfill/,
        "// range() polyfill removed for zigttp (builtin provided)",
      );
    }

    script += content + "\n";
  }

  return script;
}

/**
 * Run microbenchmarks with Deno
 */
async function runDenoMicrobench(
  suiteScript: string,
  resultsDir: string,
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
      console.log(
        `  ${name}: ${Math.floor(opsPerSec).toLocaleString()} ops/sec`,
      );
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

// All benchmark names in suite order
const ALL_BENCHMARK_NAMES = [
  "arithmetic",
  "stringOps",
  "objectCreate",
  "propertyAccess",
  "functionCalls",
  "jsonOps",
  "httpHandler",
  "httpHandlerHeavy",
  "stringBuild",
  "dynamicProps",
  "arrayOps",
  "nestedAccess",
  "queryParsing",
  "parseInt",
  "mathOps",
  "monoProperty",
  "monoPropertyWrite",
];

function parseFilter(filter?: string): string[] {
  if (!filter) return [];
  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const token of filter.split(",")) {
    const name = token.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    parsed.push(name);
  }
  return parsed;
}

function validateFilter(filter?: string): string {
  const names = parseFilter(filter);
  if (names.length === 0) return "";

  const known = new Set(ALL_BENCHMARK_NAMES);
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown microbenchmark filter name(s): ${unknown.join(", ")}. ` +
        `Known names: ${ALL_BENCHMARK_NAMES.join(", ")}`,
    );
  }
  return names.join(",");
}

// zigttp segfaults when running 9+ benchmarks in one process (GC/heap pressure).
// Split into groups of this size to work around the issue.
const ZIGTTP_GROUP_SIZE = 8;

/**
 * Run a single zigttp-bench process with a filter
 */
async function runZigttpGroup(
  config: MicrobenchConfig,
  filter: string,
  resultsDir: string,
): Promise<Record<string, BenchmarkData> | null> {
  const suiteScript = await buildSuiteScript({ ...config, filter }, "zigttp");
  const suitePath = join(
    resultsDir,
    `microbench_suite_${filter.split(",")[0]}.js`,
  );
  await Deno.writeTextFile(suitePath, suiteScript);

  const cmd = new Deno.Command(ZIGTTP_BENCH_BIN, {
    args: ["--script", suitePath],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  const output = new TextDecoder().decode(stdout).trim();

  if (code !== 0 && !output) {
    const stderrText = new TextDecoder().decode(stderr);
    console.error(`  Group [${filter}] failed (exit ${code})`);
    if (stderrText) console.error(`  ${stderrText.slice(0, 200)}`);
    return null;
  }

  if (!output) return null;

  try {
    return JSON.parse(output) as Record<string, BenchmarkData>;
  } catch {
    console.error(`  Failed to parse output for group [${filter}]`);
    return null;
  }
}

/**
 * Run microbenchmarks with zigttp
 * Splits into groups to avoid segfault with 9+ benchmarks in one process.
 */
async function runZigttpMicrobench(
  resultsDir: string,
  config: MicrobenchConfig = {},
): Promise<MicrobenchResult | null> {
  console.log("=== Microbenchmarks: zigttp ===");

  // Check if zigttp-bench binary exists
  try {
    await Deno.stat(ZIGTTP_BENCH_BIN);
  } catch {
    console.log(
      "  zigttp-bench not built, skipping (run: cd ../zigttp && zig build bench)",
    );
    console.log("");
    return null;
  }

  // Determine which benchmarks to run
  const parsedFilter = parseFilter(config.filter);
  const names = config.filter
    ? ALL_BENCHMARK_NAMES.filter((n) => parsedFilter.includes(n))
    : [...ALL_BENCHMARK_NAMES];

  // Split into groups
  const groups: string[][] = [];
  for (let i = 0; i < names.length; i += ZIGTTP_GROUP_SIZE) {
    groups.push(names.slice(i, i + ZIGTTP_GROUP_SIZE));
  }

  const allBenchmarks: Record<string, BenchmarkData> = {};

  for (const group of groups) {
    const filter = group.join(",");
    if (groups.length > 1) {
      console.log(`  Running group: ${filter}`);
    }
    const groupResults = await runZigttpGroup(config, filter, resultsDir);
    if (groupResults) {
      for (const [name, data] of Object.entries(groupResults)) {
        allBenchmarks[name] = data;
      }
    }
  }

  if (Object.keys(allBenchmarks).length === 0) {
    console.error("  No benchmark results collected");
    console.log("");
    return null;
  }

  // Print summary
  for (const [name, data] of Object.entries(allBenchmarks)) {
    const opsPerSec = data.ops_per_sec ?? 0;
    console.log(`  ${name}: ${Math.floor(opsPerSec).toLocaleString()} ops/sec`);
  }

  const result: MicrobenchResult = {
    type: "microbenchmark",
    runtime: "zigttp",
    benchmarks: allBenchmarks,
    timestamp: new Date().toISOString(),
  };

  // Save the combined suite for reference
  const fullSuiteScript = await buildSuiteScript(config, "zigttp");
  await Deno.writeTextFile(
    join(resultsDir, "microbench_suite.js"),
    fullSuiteScript,
  );
  await saveResult(resultsDir, "microbench_zigttp.json", result);
  console.log("");
  return result;
}

/**
 * Run microbenchmarks for all specified runtimes
 */
export async function runAllMicrobenchmarks(
  runtimes: Runtime[],
  resultsDir: string,
  config: MicrobenchConfig = {},
): Promise<Map<Runtime, MicrobenchResult | null>> {
  const normalizedFilter = validateFilter(config.filter);
  const fullConfig = {
    ...config,
    filter: normalizedFilter || undefined,
  };
  const results = new Map<Runtime, MicrobenchResult | null>();

  console.log("Microbenchmark Suite");
  console.log(`Results: ${resultsDir}`);
  if (fullConfig.filter) {
    console.log(`Filter: ${fullConfig.filter}`);
  }
  console.log("");

  for (const runtime of runtimes) {
    let result: MicrobenchResult | null;
    if (runtime === "deno") {
      const suiteScript = await buildSuiteScript(fullConfig, runtime);
      result = await runDenoMicrobench(suiteScript, resultsDir);
    } else {
      // zigttp builds its own suite scripts per group internally
      result = await runZigttpMicrobench(resultsDir, fullConfig);
    }
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
