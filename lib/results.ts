/**
 * Results directory and system info management
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { projectDir, getRuntimeVersions } from "./runtime.ts";
import { isoTimestamp } from "./utils.ts";

const resultsBase = join(projectDir, "results");
const baselinesDir = join(projectDir, "baselines");

export type SystemInfo = {
  timestamp: string;
  os: string;
  os_version: string;
  arch: string;
  cpu_model: string;
  cpu_cores: number;
  ram_gb: number;
  runtimes: Record<string, string>;
};

/**
 * Create a timestamped results directory
 */
export async function createResultsDir(): Promise<string> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const pid = Deno.pid;
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const dirName = `${timestamp}_${pid}_${rand}`;
  const resultsDir = join(resultsBase, dirName);

  await Deno.mkdir(resultsDir, { recursive: true });
  return resultsDir;
}

/**
 * Get macOS system information using sysctl
 */
async function getMacOSInfo(): Promise<{ cpu_model: string; ram_gb: number }> {
  try {
    const cpuCmd = new Deno.Command("sysctl", {
      args: ["-n", "machdep.cpu.brand_string"],
      stdout: "piped",
    });
    const cpuResult = await cpuCmd.output();
    const cpuModel = new TextDecoder().decode(cpuResult.stdout).trim();

    const memCmd = new Deno.Command("sysctl", {
      args: ["-n", "hw.memsize"],
      stdout: "piped",
    });
    const memResult = await memCmd.output();
    const memBytes = parseInt(new TextDecoder().decode(memResult.stdout).trim(), 10);
    const ramGb = Math.round(memBytes / (1024 * 1024 * 1024));

    return { cpu_model: cpuModel || "unknown", ram_gb: ramGb || 0 };
  } catch {
    return { cpu_model: "unknown", ram_gb: 0 };
  }
}

/**
 * Get Linux system information
 */
async function getLinuxInfo(): Promise<{ cpu_model: string; ram_gb: number }> {
  try {
    const cpuInfo = await Deno.readTextFile("/proc/cpuinfo");
    const modelMatch = cpuInfo.match(/model name\s*:\s*(.+)/);
    const cpuModel = modelMatch ? modelMatch[1].trim() : "unknown";

    const memInfo = await Deno.readTextFile("/proc/meminfo");
    const memMatch = memInfo.match(/MemTotal:\s*(\d+)/);
    const memKb = memMatch ? parseInt(memMatch[1], 10) : 0;
    const ramGb = Math.round(memKb / (1024 * 1024));

    return { cpu_model: cpuModel, ram_gb: ramGb };
  } catch {
    return { cpu_model: "unknown", ram_gb: 0 };
  }
}

/**
 * Collect system information
 */
async function collectSystemInfo(): Promise<SystemInfo> {
  const os = Deno.build.os === "darwin" ? "Darwin" : Deno.build.os;
  const arch = Deno.build.arch;

  // Get OS version
  let osVersion = "";
  try {
    const cmd = new Deno.Command("uname", { args: ["-r"], stdout: "piped" });
    const result = await cmd.output();
    osVersion = new TextDecoder().decode(result.stdout).trim();
  } catch {
    osVersion = "unknown";
  }

  // Get CPU and RAM info
  const { cpu_model, ram_gb } =
    Deno.build.os === "darwin" ? await getMacOSInfo() : await getLinuxInfo();

  // Get CPU cores
  const cpuCores = navigator?.hardwareConcurrency ?? 0;

  // Get runtime versions
  const runtimes = await getRuntimeVersions();

  return {
    timestamp: isoTimestamp(),
    os,
    os_version: osVersion,
    arch,
    cpu_model,
    cpu_cores: cpuCores,
    ram_gb,
    runtimes,
  };
}

/**
 * Save system info to results directory
 */
export async function saveSystemInfo(resultsDir: string): Promise<SystemInfo> {
  const info = await collectSystemInfo();
  const path = join(resultsDir, "system_info.json");
  await Deno.writeTextFile(path, JSON.stringify(info, null, 2));
  return info;
}

/**
 * Save any result to a JSON file
 */
export async function saveResult(
  resultsDir: string,
  filename: string,
  data: unknown
): Promise<void> {
  const path = join(resultsDir, filename);
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2));
}

/**
 * Load all JSON results from a directory
 */
export async function loadResults(
  resultsDir: string
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  for await (const entry of Deno.readDir(resultsDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      const path = join(resultsDir, entry.name);
      const content = await Deno.readTextFile(path);
      try {
        results[entry.name] = JSON.parse(content);
      } catch {
        // Silently skip invalid JSON files (e.g., broken baseline files)
      }
    }
  }

  return results;
}

/**
 * Get the baseline directory path for a mode
 */
export function getBaselineDir(mode: "quick" | "full"): string {
  return join(baselinesDir, "deno", mode);
}

/**
 * Load baseline results for comparison
 */
export async function loadBaseline(
  mode: "quick" | "full"
): Promise<Record<string, unknown> | null> {
  const baselineDir = getBaselineDir(mode);

  try {
    await Deno.stat(baselineDir);
    return await loadResults(baselineDir);
  } catch {
    return null;
  }
}
