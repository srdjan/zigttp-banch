/**
 * HTTP benchmark runner using hey CLI
 */

import { type Runtime } from "./runtime.ts";
import { ensurePortFree, getDefaultPort } from "./ports.ts";
import { startServer, stopServer, type ServerHandle } from "./server.ts";
import { saveResult } from "./results.ts";
import { sleep, isoTimestamp } from "./utils.ts";

export type EndpointConfig = {
  path: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

export type HttpConfig = {
  connections: number;
  duration: string;
  warmupRequests: number;
  endpoints: (string | EndpointConfig)[];
  cooldownSecs: number;
};

export type HttpMetrics = {
  requests_per_second: number;
  latency_avg_secs: number;
  latency_p50_secs: number;
  latency_p95_secs: number;
  latency_p99_secs: number;
  errors: number;
};

export type HttpResult = {
  type: "http_benchmark";
  runtime: string;
  endpoint: string;
  connections: number;
  duration: string;
  warmup_requests: number;
  metrics: HttpMetrics;
  timestamp: string;
};

const DEFAULT_CONFIG: HttpConfig = {
  connections: 10,
  duration: "30s",
  warmupRequests: 1000,
  endpoints: [
    "/api/health",
    "/api/echo",
    "/api/greet/world",
    "/api/process?items=500&page=3&limit=25",
  ],
  cooldownSecs: 2,
};

/**
 * Parse hey CLI output to extract metrics
 */
function parseHeyOutput(output: string): HttpMetrics {
  const rpsMatch = output.match(/Requests\/sec:\s*([\d.]+)/);
  const avgMatch = output.match(/Average:\s*([\d.]+)/);
  const p50Match = output.match(/50%\s+in\s+([\d.]+)/);
  const p95Match = output.match(/95%\s+in\s+([\d.]+)/);
  const p99Match = output.match(/99%\s+in\s+([\d.]+)/);

  // Count non-200 responses in status code distribution
  const statusSection = output.match(/Status code distribution:([\s\S]*?)(?:\n\n|$)/);
  let errors = 0;
  if (statusSection) {
    const lines = statusSection[1].split("\n");
    for (const line of lines) {
      const match = line.match(/\[(\d+)\]\s+(\d+)/);
      if (match && match[1] !== "200") {
        errors += parseInt(match[2], 10);
      }
    }
  }

  return {
    requests_per_second: rpsMatch ? parseFloat(rpsMatch[1]) : 0,
    latency_avg_secs: avgMatch ? parseFloat(avgMatch[1]) : 0,
    latency_p50_secs: p50Match ? parseFloat(p50Match[1]) : 0,
    latency_p95_secs: p95Match ? parseFloat(p95Match[1]) : 0,
    latency_p99_secs: p99Match ? parseFloat(p99Match[1]) : 0,
    errors,
  };
}

/**
 * Run hey CLI for a single endpoint
 */
async function runHey(
  url: string,
  connections: number,
  duration: string,
  options?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<{ output: string; success: boolean }> {
  const args = ["-c", String(connections), "-z", duration];

  // Add method if specified
  if (options?.method && options.method !== "GET") {
    args.push("-m", options.method);
  }

  // Add headers
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push("-H", `${key}: ${value}`);
    }
  }

  // Add body if specified (write to temp file for hey)
  let bodyFile: string | null = null;
  if (options?.body) {
    bodyFile = await Deno.makeTempFile({ prefix: "hey_body_" });
    await Deno.writeTextFile(bodyFile, options.body);
    args.push("-D", bodyFile);
  }

  args.push(url);

  const cmd = new Deno.Command("hey", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  const output = new TextDecoder().decode(stdout);
  const errors = new TextDecoder().decode(stderr);

  // Clean up temp file
  if (bodyFile) {
    try {
      await Deno.remove(bodyFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  if (code !== 0) {
    console.error(`hey failed: ${errors}`);
    return { output: "", success: false };
  }

  return { output, success: true };
}

/**
 * Run warmup requests
 */
async function warmup(
  url: string,
  requests: number,
  options?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<void> {
  const args = ["-n", String(requests), "-c", "10"];

  // Add method if specified
  if (options?.method && options.method !== "GET") {
    args.push("-m", options.method);
  }

  // Add headers
  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      args.push("-H", `${key}: ${value}`);
    }
  }

  // Add body if specified
  let bodyFile: string | null = null;
  if (options?.body) {
    bodyFile = await Deno.makeTempFile({ prefix: "hey_warmup_" });
    await Deno.writeTextFile(bodyFile, options.body);
    args.push("-D", bodyFile);
  }

  args.push(url);

  const cmd = new Deno.Command("hey", {
    args,
    stdout: "null",
    stderr: "null",
  });

  try {
    await cmd.output();
    await sleep(1000);
  } catch {
    // Warmup failure is non-fatal
  } finally {
    // Clean up temp file
    if (bodyFile) {
      try {
        await Deno.remove(bodyFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Run HTTP benchmark for a single runtime/endpoint combination
 */
async function benchmarkEndpoint(
  port: number,
  runtime: string,
  endpointConfig: string | EndpointConfig,
  config: HttpConfig,
  resultsDir: string
): Promise<HttpResult> {
  // Normalize endpoint config
  const normalized: EndpointConfig = typeof endpointConfig === "string"
    ? { path: endpointConfig }
    : endpointConfig;

  const url = `http://127.0.0.1:${port}${normalized.path}`;
  const method = normalized.method || "GET";
  const displayEndpoint = `${method} ${normalized.path}`;

  console.log(`  Endpoint: ${displayEndpoint} (${config.connections} connections)`);

  const options = {
    method: normalized.method,
    body: normalized.body,
    headers: normalized.headers,
  };

  // Warmup
  await warmup(url, config.warmupRequests, options);

  // Measured run
  const { output, success } = await runHey(url, config.connections, config.duration, options);

  const metrics = success ? parseHeyOutput(output) : {
    requests_per_second: 0,
    latency_avg_secs: 0,
    latency_p50_secs: 0,
    latency_p95_secs: 0,
    latency_p99_secs: 0,
    errors: 0,
  };

  console.log(`    RPS: ${metrics.requests_per_second.toFixed(0)}, p99: ${metrics.latency_p99_secs}s`);

  const result: HttpResult = {
    type: "http_benchmark",
    runtime,
    endpoint: displayEndpoint,
    connections: config.connections,
    duration: config.duration,
    warmup_requests: config.warmupRequests,
    metrics,
    timestamp: isoTimestamp(),
  };

  // Save result
  const safeEndpoint = displayEndpoint.replace(/[\/\s]/g, "_");
  const filename = `http_${runtime}_${safeEndpoint}_${config.connections}c.json`;
  await saveResult(resultsDir, filename, result);

  return result;
}

/**
 * Run HTTP benchmarks for a single runtime
 */
export async function runHttpBenchmarks(
  runtime: Runtime,
  resultsDir: string,
  config: Partial<HttpConfig> = {}
): Promise<HttpResult[]> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`=== Benchmarking ${runtime} ===`);

  // Get a free port
  const preferredPort = getDefaultPort(runtime);
  const { port } = await ensurePortFree(preferredPort);

  // Start server
  let handle: ServerHandle;
  try {
    handle = await startServer(runtime, port);
  } catch (e) {
    console.error(`Failed to start ${runtime} server: ${e}`);
    return [];
  }

  const results: HttpResult[] = [];

  try {
    for (const endpoint of fullConfig.endpoints) {
      const result = await benchmarkEndpoint(
        port,
        runtime,
        endpoint,
        fullConfig,
        resultsDir
      );
      results.push(result);
    }
  } finally {
    await stopServer(handle);
  }

  console.log("");
  return results;
}

/**
 * Run HTTP benchmarks for all specified runtimes
 */
export async function runAllHttpBenchmarks(
  runtimes: Runtime[],
  resultsDir: string,
  config: Partial<HttpConfig> = {}
): Promise<Map<Runtime, HttpResult[]>> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const allResults = new Map<Runtime, HttpResult[]>();

  console.log("HTTP Benchmark Suite");
  console.log(`Results: ${resultsDir}`);
  console.log(`Connections: ${fullConfig.connections}`);
  console.log("");

  for (let i = 0; i < runtimes.length; i++) {
    const runtime = runtimes[i];
    const results = await runHttpBenchmarks(runtime, resultsDir, fullConfig);
    allResults.set(runtime, results);

    // Cooldown between runtimes (not after the last one)
    if (i < runtimes.length - 1) {
      console.log(`Cooldown: ${fullConfig.cooldownSecs}s before next runtime...`);
      await sleep(fullConfig.cooldownSecs * 1000);
    }
  }

  console.log("=== HTTP Benchmarks Complete ===");
  return allResults;
}
