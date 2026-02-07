/**
 * Runtime detection and binary path resolution
 */

import {
  dirname,
  fromFileUrl,
  join,
} from "https://deno.land/std@0.220.0/path/mod.ts";

export type Runtime = "deno" | "zigttp";

const libDir = dirname(fromFileUrl(import.meta.url));
const projectDir = dirname(libDir);

export const ZIGTTP_SERVER_BIN = join(
  projectDir,
  "..",
  "zigttp",
  "zig-out",
  "bin",
  "zigttp-server",
);
export const ZIGTTP_BENCH_BIN = join(
  projectDir,
  "..",
  "zigttp",
  "zig-out",
  "bin",
  "zigttp-bench",
);

export type RuntimeAvailability = {
  deno: { available: true; version: string };
  zigttp: {
    available: boolean;
    version: string | null;
    serverBin: string;
    benchBin: string;
  };
};

/**
 * Check if a binary exists and is executable
 */
async function binaryExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Get Deno version
 */
function getDenoVersion(): string {
  return Deno.version.deno;
}

/**
 * Get zigttp version by running the binary
 */
async function getZigttpVersion(): Promise<string | null> {
  if (!(await binaryExists(ZIGTTP_SERVER_BIN))) {
    return null;
  }

  try {
    const cmd = new Deno.Command(ZIGTTP_SERVER_BIN, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout } = await cmd.output();
    if (code === 0) {
      const output = new TextDecoder().decode(stdout).trim();
      // Extract version from output like "zigttp-server 0.1.0"
      const match = output.match(/[\d.]+/);
      return match ? match[0] : output;
    }
  } catch {
    // Binary exists but doesn't support --version, return unknown
    return "unknown";
  }

  return null;
}

/**
 * Detect available runtimes and their versions
 */
export async function detectRuntimes(): Promise<RuntimeAvailability> {
  const zigttpAvailable = await binaryExists(ZIGTTP_SERVER_BIN);
  const zigttpVersion = zigttpAvailable ? await getZigttpVersion() : null;

  return {
    deno: {
      available: true,
      version: getDenoVersion(),
    },
    zigttp: {
      available: zigttpAvailable,
      version: zigttpVersion,
      serverBin: ZIGTTP_SERVER_BIN,
      benchBin: ZIGTTP_BENCH_BIN,
    },
  };
}

/**
 * Get runtime versions for system info
 */
export async function getRuntimeVersions(): Promise<Record<string, string>> {
  const runtimes = await detectRuntimes();
  const versions: Record<string, string> = {
    deno: runtimes.deno.version,
  };

  if (runtimes.zigttp.available && runtimes.zigttp.version) {
    versions.zigttp = runtimes.zigttp.version;
  }

  return versions;
}

/**
 * Get list of runtimes to run based on argument and availability
 */
export async function getRuntimesToRun(
  runtimeArg: Runtime | "all",
): Promise<Runtime[]> {
  const runtimes = await detectRuntimes();
  const result: Runtime[] = [];

  if (runtimeArg === "all" || runtimeArg === "deno") {
    result.push("deno");
  }

  if (runtimeArg === "all" || runtimeArg === "zigttp") {
    if (runtimes.zigttp.available) {
      result.push("zigttp");
    } else if (runtimeArg === "zigttp") {
      console.log(
        "zigttp not built, skipping (run: cd ../zigttp && zig build -Doptimize=ReleaseFast)",
      );
    }
  }

  return result;
}

export { projectDir };
