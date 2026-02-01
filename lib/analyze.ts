/**
 * Analysis and report generation
 * Replaces Python analyze.py
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { loadResults, loadBaseline, type SystemInfo } from "./results.ts";
import { formatOpsPerSec, type MicrobenchResult } from "./microbench.ts";
import { type HttpResult } from "./http.ts";
import { type ColdStartResult } from "./coldstart.ts";
import { type MemoryResult } from "./memory.ts";
import { detectMode } from "./utils.ts";

type ParsedResults = {
  system?: SystemInfo;
  http: HttpResult[];
  coldstart: ColdStartResult[];
  memory: MemoryResult[];
  microbench: MicrobenchResult[];
};

/**
 * Parse raw JSON files into structured results
 */
function parseResults(rawResults: Record<string, unknown>): ParsedResults {
  const parsed: ParsedResults = {
    http: [],
    coldstart: [],
    memory: [],
    microbench: [],
  };

  for (const [filename, data] of Object.entries(rawResults)) {
    if (filename === "system_info.json") {
      parsed.system = data as SystemInfo;
    } else if (filename.startsWith("http_")) {
      parsed.http.push(data as HttpResult);
    } else if (filename.startsWith("coldstart_")) {
      parsed.coldstart.push(data as ColdStartResult);
    } else if (filename.startsWith("memory_")) {
      parsed.memory.push(data as MemoryResult);
    } else if (filename.startsWith("microbench_")) {
      parsed.microbench.push(data as MicrobenchResult);
    }
  }

  return parsed;
}

/**
 * Format number with comma separators
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Generate markdown report from results
 */
export function generateReport(
  results: ParsedResults,
  baseline?: ParsedResults
): string {
  const lines: string[] = [];

  lines.push("# Benchmark Results");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push("");

  // System info
  if (results.system) {
    const sys = results.system;
    lines.push("## System Information");
    lines.push("");
    lines.push(`- **OS:** ${sys.os} ${sys.os_version}`);
    lines.push(`- **CPU:** ${sys.cpu_model}`);
    lines.push(`- **Cores:** ${sys.cpu_cores}`);
    lines.push(`- **RAM:** ${sys.ram_gb} GB`);
    lines.push("");

    if (sys.runtimes && Object.keys(sys.runtimes).length > 0) {
      lines.push("### Runtime Versions");
      lines.push("");
      for (const [rt, ver] of Object.entries(sys.runtimes)) {
        lines.push(`- **${rt}:** ${ver}`);
      }
      lines.push("");
    }
  }

  // HTTP Results
  if (results.http.length > 0) {
    lines.push("## HTTP Benchmark Results");
    lines.push("");

    // Group by endpoint
    const sortedHttp = [...results.http].sort((a, b) => {
      if (a.runtime !== b.runtime) return a.runtime.localeCompare(b.runtime);
      return a.endpoint.localeCompare(b.endpoint);
    });

    lines.push("| Runtime | Endpoint | RPS | p99 Latency |");
    lines.push("|---------|----------|-----|-------------|");

    for (const data of sortedHttp) {
      const rps = data.metrics.requests_per_second;
      const p99 = data.metrics.latency_p99_secs;
      lines.push(`| ${data.runtime} | ${data.endpoint} | ${formatNumber(Math.round(rps))} | ${p99.toFixed(4)}s |`);
    }
    lines.push("");
  }

  // Microbenchmark Results
  if (results.microbench.length > 0) {
    lines.push("## Microbenchmark Results");
    lines.push("");

    // Collect all benchmark names
    const benchNames = new Set<string>();
    for (const mb of results.microbench) {
      for (const name of Object.keys(mb.benchmarks)) {
        benchNames.add(name);
      }
    }

    const runtimes = results.microbench.map((mb) => mb.runtime).sort();
    const sortedNames = [...benchNames].sort();

    if (sortedNames.length > 0 && runtimes.length > 0) {
      const header = `| Benchmark |${runtimes.map((rt) => ` ${rt} |`).join("")}`;
      lines.push(header);
      lines.push("|" + "---|".repeat(runtimes.length + 1));

      for (const name of sortedNames) {
        let row = `| ${name} |`;
        for (const rt of runtimes) {
          const mb = results.microbench.find((m) => m.runtime === rt);
          if (mb && mb.benchmarks[name]) {
            const ops = mb.benchmarks[name].ops_per_sec ?? 0;
            row += ` ${formatOpsPerSec(ops)} ops/s |`;
          } else {
            row += " - |";
          }
        }
        lines.push(row);
      }
      lines.push("");
    }
  }

  // Cold Start Results
  if (results.coldstart.length > 0) {
    lines.push("## Cold Start Results");
    lines.push("");
    lines.push("| Runtime | Mean | Median | p95 | p99 |");
    lines.push("|---------|------|--------|-----|-----|");

    const sortedColdstart = [...results.coldstart].sort((a, b) =>
      a.runtime.localeCompare(b.runtime)
    );

    for (const data of sortedColdstart) {
      const m = data.metrics;
      lines.push(
        `| ${data.runtime} | ${formatNumber(m.mean_us)}us | ${formatNumber(m.median_us)}us | ${formatNumber(m.p95_us)}us | ${formatNumber(m.p99_us)}us |`
      );
    }
    lines.push("");
  }

  // Memory Results
  if (results.memory.length > 0) {
    lines.push("## Memory Usage");
    lines.push("");
    lines.push("| Runtime | Baseline | Peak | Avg |");
    lines.push("|---------|----------|------|-----|");

    const sortedMemory = [...results.memory].sort((a, b) =>
      a.runtime.localeCompare(b.runtime)
    );

    for (const data of sortedMemory) {
      const m = data.metrics;
      // Skip if metrics are missing (broken memory profiling)
      if (m.baseline_kb && m.peak_kb) {
        lines.push(
          `| ${data.runtime} | ${formatNumber(m.baseline_kb)} KB | ${formatNumber(m.peak_kb)} KB | ${formatNumber(m.avg_kb)} KB |`
        );
      } else {
        lines.push(`| ${data.runtime} | - | - | - |`);
      }
    }
    lines.push("");
  }

  // Baseline comparison
  if (baseline) {
    lines.push("## Baseline Comparison (vs Deno)");
    lines.push("");

    // HTTP comparison
    if (results.http.length > 0 && baseline.http.length > 0) {
      lines.push("### HTTP Throughput Ratio");
      lines.push("");

      for (const result of results.http) {
        if (result.runtime === "deno") continue;

        const baselineMatch = baseline.http.find(
          (b) => b.endpoint === result.endpoint
        );
        if (baselineMatch) {
          const ratio = result.metrics.requests_per_second / baselineMatch.metrics.requests_per_second;
          const percent = ((ratio - 1) * 100).toFixed(1);
          const sign = ratio >= 1 ? "+" : "";
          lines.push(`- ${result.endpoint}: ${ratio.toFixed(2)}x (${sign}${percent}%)`);
        }
      }
      lines.push("");
    }

    // Microbench comparison
    if (results.microbench.length > 0 && baseline.microbench.length > 0) {
      const baselineMb = baseline.microbench.find((m) => m.runtime === "deno");
      const resultMb = results.microbench.find((m) => m.runtime !== "deno");

      if (baselineMb && resultMb) {
        lines.push("### Microbenchmark Ratio");
        lines.push("");

        const names = Object.keys(resultMb.benchmarks).sort();
        for (const name of names) {
          const baseOps = baselineMb.benchmarks[name]?.ops_per_sec;
          const resultOps = resultMb.benchmarks[name]?.ops_per_sec;

          if (baseOps && resultOps) {
            const ratio = resultOps / baseOps;
            const percent = ((ratio - 1) * 100).toFixed(1);
            const sign = ratio >= 1 ? "+" : "";
            lines.push(`- ${name}: ${ratio.toFixed(2)}x (${sign}${percent}%)`);
          }
        }
        lines.push("");
      }
    }
  }

  lines.push("## Methodology");
  lines.push("");
  lines.push("See [methodology.md](../methodology.md) for detailed test methodology.");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate and save report to file
 */
export async function generateReportFile(
  resultsDir: string,
  outputPath?: string
): Promise<void> {
  const rawResults = await loadResults(resultsDir);
  const results = parseResults(rawResults);

  // Try to load baseline for comparison
  const mode = detectMode(resultsDir, rawResults);
  const rawBaseline = await loadBaseline(mode);
  const baseline = rawBaseline ? parseResults(rawBaseline) : undefined;

  const report = generateReport(results, baseline);

  const reportPath = outputPath ?? join(resultsDir, "report.md");
  await Deno.writeTextFile(reportPath, report);

  console.log(`Report written to: ${reportPath}`);
}

/**
 * Compare two result directories
 */
export async function compareResults(
  resultsDir: string,
  baselineDir: string
): Promise<string> {
  const rawResults = await loadResults(resultsDir);
  const rawBaseline = await loadResults(baselineDir);

  const results = parseResults(rawResults);
  const baseline = parseResults(rawBaseline);

  return generateReport(results, baseline);
}
