#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net --allow-env

/**
 * Benchmark Suite CLI
 * Single entry point for all benchmark types
 *
 * Usage:
 *   deno run -A bench.ts http [runtime]     # HTTP benchmarks
 *   deno run -A bench.ts micro [runtime]    # Microbenchmarks
 *   deno run -A bench.ts cold [runtime]     # Cold start
 *   deno run -A bench.ts memory [runtime]   # Memory profiling
 *   deno run -A bench.ts full [runtime]     # All of the above
 *   deno run -A bench.ts quick [runtime]    # Short validation run
 *   deno run -A bench.ts compare <dir>      # Compare against baseline
 *   deno run -A bench.ts report <dir>       # Generate report
 */

import {
  detectRuntimes,
  getRuntimesToRun,
  type Runtime,
} from "./lib/runtime.ts";
import {
  createResultsDir,
  getBaselineDir,
  loadResults,
  saveResult,
  saveSystemInfo,
} from "./lib/results.ts";
import { detectMode } from "./lib/utils.ts";
import {
  type HttpConfig,
  type HttpMode,
  runAllHttpBenchmarks,
} from "./lib/http.ts";
import {
  type ColdStartConfig,
  runAllColdStartBenchmarks,
} from "./lib/coldstart.ts";
import { runAllMemoryProfiles } from "./lib/memory.ts";
import {
  type MicrobenchConfig,
  runAllMicrobenchmarks,
} from "./lib/microbench.ts";
import { compareResults, generateReportFile } from "./lib/analyze.ts";

type Command =
  | "http"
  | "micro"
  | "cold"
  | "memory"
  | "full"
  | "quick"
  | "compare"
  | "report"
  | "help";

type Options = {
  command: Command;
  runtime: Runtime | "all";
  connections?: number;
  httpMode: HttpMode;
  zigttpPool?: number;
  poolSweep?: number[];
  filter?: string;
  iterations?: number;
  target?: string; // For compare/report commands
};

function printUsage(): void {
  console.log(`
Benchmark Suite CLI

Usage:
  deno run -A bench.ts <command> [runtime] [options]

Commands:
  http [runtime]       Run HTTP benchmarks
  micro [runtime]      Run microbenchmarks
  cold [runtime]       Run cold start benchmarks
  memory [runtime]     Run memory profiling
  full [runtime]       Run all benchmarks (http + micro + cold + memory)
  quick [runtime]      Quick validation run (short duration, few connections)
  compare <dir>        Compare results against baseline
  report <dir>         Generate report from results directory
  help                 Show this help message

Runtime:
  deno                 Run only Deno benchmarks
  zigttp               Run only zigttp benchmarks
  node                 Run only Node.js benchmarks
  bun                  Run only Bun benchmarks
  all                  Run all available (default)

Options:
  --connections=N      Number of connections for HTTP benchmarks (default: 10)
  --http-mode=MODE     HTTP benchmark mode: parity|implementation|floor (default: parity)
  --zigttp-pool=N      Override zigttp runtime pool size (HTTP benchmarks)
  --pool-sweep=a,b,c   Run zigttp HTTP benchmarks for each pool size
  --filter=name1,name2 Filter microbenchmarks by name
  --iterations=N       Number of iterations for cold start (default: 100)

Examples:
  deno run -A bench.ts quick zigttp
  deno run -A bench.ts http deno --connections=20 --http-mode=parity
  deno run -A bench.ts http all --http-mode=floor --pool-sweep=8,12,16,28
  deno run -A bench.ts micro zigttp --filter=arithmetic,stringOps
  deno run -A bench.ts compare results/20260126_123456_1234_5678
  deno run -A bench.ts report results/20260126_123456_1234_5678
`);
}

function parsePositiveInt(name: string, raw: string): number {
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${raw} (must be a positive integer)`);
  }
  return value;
}

function parsePoolSweep(raw: string): number[] {
  const pools = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parsePositiveInt("pool size", part));

  if (pools.length === 0) {
    throw new Error(
      `Invalid --pool-sweep: ${raw} (expected comma-separated positive integers)`,
    );
  }

  return [...new Set(pools)];
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    command: "help",
    runtime: "all",
    httpMode: "parity",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Commands
    if (
      [
        "http",
        "micro",
        "cold",
        "memory",
        "full",
        "quick",
        "compare",
        "report",
        "help",
      ].includes(arg)
    ) {
      options.command = arg as Command;
      continue;
    }

    // Runtime
    if (
      arg === "deno" || arg === "zigttp" || arg === "node" || arg === "bun" ||
      arg === "all"
    ) {
      options.runtime = arg as Runtime | "all";
      continue;
    }

    // Options
    if (arg.startsWith("--connections=")) {
      const value = arg.split("=")[1];
      options.connections = parsePositiveInt("connections", value);
      continue;
    }

    if (arg.startsWith("--http-mode=")) {
      const mode = arg.split("=")[1];
      if (
        mode !== "parity" && mode !== "implementation" && mode !== "floor"
      ) {
        throw new Error(
          `Invalid --http-mode: ${mode} (expected parity|implementation|floor)`,
        );
      }
      options.httpMode = mode;
      continue;
    }

    if (arg.startsWith("--zigttp-pool=")) {
      const value = arg.split("=")[1];
      options.zigttpPool = parsePositiveInt("zigttp pool", value);
      continue;
    }

    if (arg.startsWith("--pool-sweep=")) {
      const value = arg.split("=")[1];
      options.poolSweep = parsePoolSweep(value);
      continue;
    }

    if (arg.startsWith("--filter=")) {
      options.filter = arg.split("=")[1];
      continue;
    }

    if (arg.startsWith("--iterations=")) {
      const value = arg.split("=")[1];
      options.iterations = parsePositiveInt("iterations", value);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    // Target directory for compare/report
    if (!arg.startsWith("--") && !options.target) {
      if (options.command === "compare" || options.command === "report") {
        options.target = arg;
        continue;
      }
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

async function runHttp(
  runtimes: Runtime[],
  resultsDir: string,
  options: Options,
): Promise<void> {
  if (options.poolSweep && options.zigttpPool) {
    throw new Error(
      "Use either --pool-sweep or --zigttp-pool (not both together)",
    );
  }

  const config: Partial<HttpConfig> = {
    mode: options.httpMode,
    zigttpPoolSize: options.zigttpPool,
  };

  if (options.connections) {
    config.connections = options.connections;
  }

  if (options.poolSweep && options.poolSweep.length > 0) {
    if (runtimes.includes("deno")) {
      await runAllHttpBenchmarks(["deno"], resultsDir, {
        ...config,
        zigttpPoolSize: undefined,
      });
      console.log("");
    }

    if (runtimes.includes("zigttp")) {
      for (const poolSize of options.poolSweep) {
        console.log(`=== zigttp Pool Sweep: n=${poolSize} ===`);
        await runAllHttpBenchmarks(["zigttp"], resultsDir, {
          ...config,
          zigttpPoolSize: poolSize,
        });
        console.log("");
      }
    }
    return;
  }

  await runAllHttpBenchmarks(runtimes, resultsDir, config);
}

async function runMicro(
  runtimes: Runtime[],
  resultsDir: string,
  options: Options,
): Promise<void> {
  const config: MicrobenchConfig = {};

  if (options.filter) {
    config.filter = options.filter;
  }

  await runAllMicrobenchmarks(runtimes, resultsDir, config);
}

async function runCold(
  runtimes: Runtime[],
  resultsDir: string,
  options: Options,
): Promise<void> {
  const config: Partial<ColdStartConfig> = {};

  if (options.iterations) {
    config.iterations = options.iterations;
  }

  await runAllColdStartBenchmarks(runtimes, resultsDir, config);
}

async function runMemory(
  runtimes: Runtime[],
  resultsDir: string,
  _options: Options,
): Promise<void> {
  await runAllMemoryProfiles(runtimes, resultsDir);
}

async function runFull(
  runtimes: Runtime[],
  resultsDir: string,
  options: Options,
): Promise<void> {
  await runHttp(runtimes, resultsDir, options);
  console.log("");

  await runMicro(runtimes, resultsDir, options);
  console.log("");

  await runCold(runtimes, resultsDir, options);
  console.log("");

  await runMemory(runtimes, resultsDir, options);
}

async function runQuick(
  runtimes: Runtime[],
  resultsDir: string,
  options: Options,
): Promise<void> {
  if (options.poolSweep && options.zigttpPool) {
    throw new Error(
      "Use either --pool-sweep or --zigttp-pool (not both together)",
    );
  }

  console.log("Quick validation mode: reduced duration and iterations");
  console.log("");

  // Quick HTTP: 1 connection, 5s duration
  const httpConfig: Partial<HttpConfig> = {
    connections: 1,
    duration: "5s",
    warmupRequests: 100,
    mode: options.httpMode,
    zigttpPoolSize: options.zigttpPool,
  };

  if (options.poolSweep && options.poolSweep.length > 0) {
    if (runtimes.includes("deno")) {
      await runAllHttpBenchmarks(["deno"], resultsDir, {
        ...httpConfig,
        zigttpPoolSize: undefined,
      });
      console.log("");
    }

    if (runtimes.includes("zigttp")) {
      for (const poolSize of options.poolSweep) {
        console.log(`=== zigttp Pool Sweep: n=${poolSize} ===`);
        await runAllHttpBenchmarks(["zigttp"], resultsDir, {
          ...httpConfig,
          zigttpPoolSize: poolSize,
        });
        console.log("");
      }
    }
  } else {
    await runAllHttpBenchmarks(runtimes, resultsDir, httpConfig);
  }
  console.log("");

  // Quick Microbench: reduced iterations
  const microConfig: MicrobenchConfig = {
    warmupIterations: 5,
    measuredIterations: 8,
    filter: options.filter,
  };
  await runAllMicrobenchmarks(runtimes, resultsDir, microConfig);
  console.log("");

  // Quick Cold Start: 10 iterations
  const coldConfig: Partial<ColdStartConfig> = {
    iterations: 10,
  };
  await runAllColdStartBenchmarks(runtimes, resultsDir, coldConfig);

  // Skip memory profiling in quick mode (too slow)
}

async function runCompare(options: Options): Promise<void> {
  if (!options.target) {
    console.error("Error: compare command requires a results directory");
    console.error("Usage: deno run -A bench.ts compare <results-dir>");
    Deno.exit(1);
  }

  let mode: "quick" | "full" = "full";
  try {
    const rawResults = await loadResults(options.target);
    mode = detectMode(options.target, rawResults);
  } catch {
    // Fall back to default
    mode = options.target.includes("quick") ? "quick" : "full";
  }
  const baselineDir = getBaselineDir(mode);

  console.log(`Comparing ${options.target} against ${baselineDir}`);
  console.log("");

  const report = await compareResults(options.target, baselineDir);
  console.log(report);
}

async function runReport(options: Options): Promise<void> {
  if (!options.target) {
    console.error("Error: report command requires a results directory");
    console.error("Usage: deno run -A bench.ts report <results-dir>");
    Deno.exit(1);
  }

  await generateReportFile(options.target);
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArgs(Deno.args);
  } catch (e) {
    console.error(
      "Argument error:",
      e instanceof Error ? e.message : String(e),
    );
    console.error("");
    printUsage();
    Deno.exit(1);
  }

  if (options.command === "help" || Deno.args.length === 0) {
    printUsage();
    return;
  }

  // Handle compare and report commands separately
  if (options.command === "compare") {
    await runCompare(options);
    return;
  }

  if (options.command === "report") {
    await runReport(options);
    return;
  }

  // Check runtime availability
  const runtimeInfo = await detectRuntimes();
  console.log("Runtime Detection:");
  console.log(`  deno: ${runtimeInfo.deno.version}`);
  if (runtimeInfo.zigttp.available) {
    console.log(`  zigttp: ${runtimeInfo.zigttp.version ?? "available"}`);
  } else {
    console.log("  zigttp: not built");
  }
  if (runtimeInfo.node.available) {
    console.log(`  node: ${runtimeInfo.node.version}`);
  } else {
    console.log("  node: not found");
  }
  if (runtimeInfo.bun.available) {
    console.log(`  bun: ${runtimeInfo.bun.version}`);
  } else {
    console.log("  bun: not found");
  }
  console.log("");

  // Get runtimes to run
  const runtimes = await getRuntimesToRun(options.runtime);

  if (runtimes.length === 0) {
    console.error("No runtimes available to benchmark");
    Deno.exit(1);
  }

  // Create results directory
  const resultsDir = await createResultsDir();
  console.log(`Results directory: ${resultsDir}`);
  console.log("");

  const mode: "quick" | "full" = options.command === "quick" ? "quick" : "full";
  await saveResult(resultsDir, "run_meta.json", {
    mode,
    command: options.command,
  });

  // Save system info
  await saveSystemInfo(resultsDir);

  // Run the appropriate benchmark
  switch (options.command) {
    case "http":
      await runHttp(runtimes, resultsDir, options);
      break;
    case "micro":
      await runMicro(runtimes, resultsDir, options);
      break;
    case "cold":
      await runCold(runtimes, resultsDir, options);
      break;
    case "memory":
      await runMemory(runtimes, resultsDir, options);
      break;
    case "full":
      await runFull(runtimes, resultsDir, options);
      break;
    case "quick":
      await runQuick(runtimes, resultsDir, options);
      break;
  }

  // Generate report
  console.log("");
  await generateReportFile(resultsDir);

  console.log("");
  console.log("=== Benchmark Suite Complete ===");
  console.log(`Results saved to: ${resultsDir}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  Deno.exit(1);
});
