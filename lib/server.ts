/**
 * Server lifecycle management for benchmark runners
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { projectDir, type Runtime, ZIGTTP_SERVER_BIN } from "./runtime.ts";
import { waitForPortFree, waitForServer } from "./ports.ts";

export type ServerHandle = {
  process: Deno.ChildProcess;
  pid: number;
  port: number;
  runtime: Runtime;
};

export type StartServerOptions = {
  zigttpPoolSize?: number;
};

// Global registry of active servers for cleanup
const activeServers = new Set<ServerHandle>();

async function captureStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number = 8192,
): Promise<string> {
  if (!stream) return "";

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.length;
      while (total > maxBytes && chunks.length > 0) {
        const removed = chunks.shift();
        total -= removed?.length ?? 0;
      }
    }
  } catch {
    // Ignore stream read failures; this is best-effort diagnostics.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release failures
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged).trim();
}

function formatStartupErrorDetails(stdout: string, stderr: string): string {
  if (!stdout && !stderr) return "";

  const parts: string[] = [];
  if (stderr) {
    parts.push(`stderr:\n${stderr}`);
  }
  if (stdout) {
    parts.push(`stdout:\n${stdout}`);
  }
  return `\n\nProcess output:\n${parts.join("\n\n")}`;
}

// Register cleanup handler for unexpected exits
const cleanupHandler = () => {
  for (const handle of activeServers) {
    try {
      handle.process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }
  }
};

// Register cleanup on Deno unload
globalThis.addEventListener("unload", cleanupHandler);

/**
 * Start a server for the specified runtime
 */
export async function startServer(
  runtime: Runtime,
  port: number,
  handlerPath?: string,
  options: StartServerOptions = {},
): Promise<ServerHandle> {
  const defaultHandlers: Record<Runtime, string> = {
    deno: join(projectDir, "handlers", "deno", "server.ts"),
    zigttp: join(projectDir, "handlers", "zigttp", "handler.js"),
    node: join(projectDir, "handlers", "node", "server.js"),
    bun: join(projectDir, "handlers", "bun", "server.ts"),
  };

  const handler = handlerPath ?? defaultHandlers[runtime];

  let cmd: Deno.Command;

  if (runtime === "deno") {
    cmd = new Deno.Command("deno", {
      args: ["run", "--allow-net", "--allow-env", handler],
      env: { ...Deno.env.toObject(), PORT: String(port) },
      stdout: "piped",
      stderr: "piped",
    });
  } else if (runtime === "zigttp") {
    const args = ["-p", String(port), "-q"];
    if (options.zigttpPoolSize) {
      args.push("-n", String(options.zigttpPoolSize));
    }
    args.push(handler);

    cmd = new Deno.Command(ZIGTTP_SERVER_BIN, {
      args,
      stdout: "piped",
      stderr: "piped",
    });
  } else if (runtime === "node") {
    cmd = new Deno.Command("node", {
      args: [handler],
      env: { ...Deno.env.toObject(), PORT: String(port) },
      stdout: "piped",
      stderr: "piped",
    });
  } else {
    // bun
    cmd = new Deno.Command("bun", {
      args: ["run", handler],
      env: { ...Deno.env.toObject(), PORT: String(port) },
      stdout: "piped",
      stderr: "piped",
    });
  }

  const process = cmd.spawn();
  const stdoutCapture = captureStream(process.stdout);
  const stderrCapture = captureStream(process.stderr);
  const pid = process.pid;

  const handle: ServerHandle = { process, pid, port, runtime };
  activeServers.add(handle);

  // Give server time to start
  await new Promise((r) => setTimeout(r, 500));

  // Wait for server to be ready
  const ready = await waitForServer(port, "/api/health", 5000);
  if (!ready) {
    await stopServer(handle);
    const [stdout, stderr] = await Promise.all([stdoutCapture, stderrCapture]);
    const details = formatStartupErrorDetails(stdout, stderr);
    throw new Error(
      `${runtime} server failed to start on port ${port}${details}`,
    );
  }

  return handle;
}

/**
 * Stop a server gracefully (SIGTERM then SIGKILL)
 */
export async function stopServer(handle: ServerHandle): Promise<void> {
  activeServers.delete(handle);

  // First try SIGTERM for graceful shutdown
  try {
    handle.process.kill("SIGTERM");
  } catch {
    // Process may have already exited
    return;
  }

  // Wait up to 2 seconds for graceful shutdown
  const gracefulTimeoutMs = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < gracefulTimeoutMs) {
    try {
      const status = await Promise.race([
        handle.process.status,
        new Promise<null>((r) => setTimeout(() => r(null), 100)),
      ]);

      if (status !== null) {
        // Process exited
        await waitForPortFree(handle.port, 1000);
        return;
      }
    } catch {
      // Process already exited
      return;
    }
  }

  // Force kill if still running
  try {
    handle.process.kill("SIGKILL");
    await handle.process.status;
  } catch {
    // Already dead
  }

  await waitForPortFree(handle.port, 1000);
}
