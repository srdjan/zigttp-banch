/**
 * Port management utilities for benchmark servers
 */

const DEFAULT_PORT_DENO = 8080;
const DEFAULT_PORT_ZIGTTP = 8081;

/**
 * Check if a port is free (not listening)
 */
export async function isPortFree(port: number): Promise<boolean> {
  try {
    // Try to connect - if connection succeeds, port is in use
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    conn.close();
    return false;
  } catch (e) {
    if (e instanceof Deno.errors.ConnectionRefused) {
      return true;
    }
    // Other errors (permission, etc.) - assume port might be in use
    return false;
  }
}

/**
 * Wait for a port to become free
 */
export async function waitForPortFree(
  port: number,
  timeoutMs: number = 5000
): Promise<boolean> {
  const startTime = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startTime < timeoutMs) {
    if (await isPortFree(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return false;
}

/**
 * Wait for a server to be ready by polling a health endpoint
 */
export async function waitForServer(
  port: number,
  healthPath: string = "/api/health",
  timeoutMs: number = 5000
): Promise<boolean> {
  const startTime = Date.now();
  const pollIntervalMs = 100;
  const url = `http://127.0.0.1:${port}${healthPath}`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return false;
}

/**
 * Find a free port in the ephemeral range
 */
async function pickFreePort(startPort: number = 49152): Promise<number> {
  // Try ports starting from startPort up to 65535
  for (let port = startPort; port <= 65535; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }

  // Fallback: use a random port in ephemeral range
  const fallback = 49152 + (Deno.pid + Date.now()) % 16383;
  return fallback;
}

/**
 * Get the default port for a runtime
 */
export function getDefaultPort(runtime: "deno" | "zigttp"): number {
  return runtime === "deno" ? DEFAULT_PORT_DENO : DEFAULT_PORT_ZIGTTP;
}

/**
 * Ensure a port is free, picking an alternative if not
 */
export async function ensurePortFree(
  preferredPort: number
): Promise<{ port: number; switched: boolean }> {
  if (await isPortFree(preferredPort)) {
    return { port: preferredPort, switched: false };
  }

  const newPort = await pickFreePort();
  console.log(`Port ${preferredPort} is in use, switching to ${newPort}`);
  return { port: newPort, switched: true };
}
