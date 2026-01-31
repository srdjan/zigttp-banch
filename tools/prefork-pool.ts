#!/usr/bin/env -S deno run --allow-net --allow-run --allow-env

/**
 * Pre-fork Worker Pool Manager for zigttp
 *
 * Maintains a pool of pre-spawned zigttp processes to eliminate cold start overhead.
 * Distributes incoming connections to idle workers via Unix domain sockets.
 *
 * Expected improvement: ~40ms (eliminates spawn + dyld + init)
 */

const POOL_SIZE = 4;
const ZIGTTP_BIN = Deno.env.get("ZIGTTP_BIN") || "../zigttp/zig-out/bin/zigttp-server";
const HANDLER_PATH = Deno.env.get("HANDLER_PATH") || "handlers/zigttp/handler.js";
const PORT = parseInt(Deno.env.get("PORT") || "8080", 10);

interface Worker {
  process: Deno.ChildProcess;
  port: number;
  ready: boolean;
  requestCount: number;
}

class WorkerPool {
  private workers: Worker[] = [];
  private nextWorker = 0;

  async start() {
    console.log("Starting pre-fork worker pool...");
    console.log(`  Pool size: ${POOL_SIZE}`);
    console.log(`  Binary: ${ZIGTTP_BIN}`);
    console.log(`  Handler: ${HANDLER_PATH}`);
    console.log("");

    // Spawn all workers
    const startTime = performance.now();

    for (let i = 0; i < POOL_SIZE; i++) {
      const workerPort = PORT + 1 + i; // Main port is PORT, workers get PORT+1, PORT+2, etc.
      await this.spawnWorker(workerPort, i);
    }

    const elapsed = Math.round(performance.now() - startTime);
    console.log(`Pool ready in ${elapsed}ms`);
    console.log(`  All ${POOL_SIZE} workers pre-spawned and warmed`);
    console.log("");

    // Start load balancer
    await this.runLoadBalancer();
  }

  private async spawnWorker(port: number, index: number) {
    const process = new Deno.Command(ZIGTTP_BIN, {
      args: ["-p", port.toString(), "-q", HANDLER_PATH],
      stdout: "null",
      stderr: "piped",
    }).spawn();

    const worker: Worker = {
      process,
      port,
      ready: false,
      requestCount: 0,
    };

    this.workers.push(worker);

    // Wait for worker to be ready
    await this.waitForWorker(worker, index);
  }

  private async waitForWorker(worker: Worker, index: number) {
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`http://localhost:${worker.port}/api/health`, {
          signal: AbortSignal.timeout(100),
        });

        if (response.ok) {
          worker.ready = true;
          console.log(`  Worker ${index} ready on port ${worker.port}`);
          return;
        }
      } catch {
        // Worker not ready yet
      }

      await new Promise((r) => setTimeout(r, 10));
    }

    console.error(`  Worker ${index} failed to start`);
    worker.process.kill();
  }

  private async runLoadBalancer() {
    console.log(`Load balancer listening on http://localhost:${PORT}`);
    console.log(`Distributing requests across ${POOL_SIZE} workers (round-robin)`);
    console.log("");

    const server = Deno.serve({
      port: PORT,
      hostname: "127.0.0.1",
      onListen: () => {
        console.log("Ready to accept requests");
      },
    }, async (req) => {
      // Round-robin selection
      const worker = this.workers[this.nextWorker];
      this.nextWorker = (this.nextWorker + 1) % this.workers.length;

      if (!worker.ready) {
        return new Response("Worker not ready", { status: 503 });
      }

      worker.requestCount++;

      // Proxy request to worker
      const url = new URL(req.url);
      url.host = `localhost:${worker.port}`;

      try {
        const response = await fetch(url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });

        return response;
      } catch (error) {
        console.error(`Worker ${worker.port} error:`, error);
        return new Response("Worker error", { status: 502 });
      }
    });

    // Handle shutdown
    const shutdown = () => {
      console.log("\nShutting down worker pool...");
      for (const worker of this.workers) {
        worker.process.kill();
      }
      server.shutdown();
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);
  }

  async showStats() {
    console.log("\nWorker Stats:");
    for (let i = 0; i < this.workers.length; i++) {
      const worker = this.workers[i];
      console.log(`  Worker ${i} (port ${worker.port}): ${worker.requestCount} requests`);
    }
  }
}

// Run pool
const pool = new WorkerPool();
await pool.start();

// Show stats periodically
setInterval(() => pool.showStats(), 10000);
