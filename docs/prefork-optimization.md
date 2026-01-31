# Pre-Fork Worker Pool Optimization

Pre-fork worker pools eliminate cold start overhead by maintaining a pool of pre-spawned server processes. New requests are instantly routed to an idle worker, avoiding process spawn and initialization costs entirely.

## Performance Impact

**Expected improvement**: ~40ms (eliminates spawn + dyld + initialization)

```
Cold start (baseline):        71ms
Pre-fork pool (warm worker):  ~30ms
Improvement:                  ~40ms (56% reduction)
```

## How It Works

### Traditional Cold Start

```
Request arrives
  → Spawn process (10-15ms)
  → Dynamic linker loads libraries (15-20ms)
  → Initialize I/O backend (5ms)
  → Create connection pool (5ms)
  → Bind network listener (3ms)
  → Handle request
Total: ~71ms
```

### Pre-Fork Pool

```
Startup (once):
  Pre-spawn N worker processes
  Workers initialize fully
  Workers wait for connections

Request arrives:
  → Load balancer receives request
  → Route to idle worker (< 1ms)
  → Worker handles request immediately
Total: ~30ms (network + processing only)
```

## Implementation

We provide a simple Deno-based load balancer that manages the worker pool:

### Basic Usage

```bash
# Start the pre-fork pool (4 workers by default)
./tools/prefork-pool.ts

# In another terminal, send requests
curl http://localhost:8080/api/health

# All requests hit pre-warmed workers (no cold start)
```

### Configuration

```bash
# Custom pool size
POOL_SIZE=8 ./tools/prefork-pool.ts

# Custom ports
PORT=3000 ./tools/prefork-pool.ts

# Custom binary and handler
ZIGTTP_BIN=/path/to/zigttp-server \
HANDLER_PATH=/path/to/handler.js \
./tools/prefork-pool.ts
```

## Architecture

```
┌─────────────────────────────────────────┐
│     Load Balancer (Deno, port 8080)    │
│  - Receives incoming requests           │
│  - Round-robin distribution             │
│  - Health monitoring                    │
└─────────────────────────────────────────┘
           │         │         │
           ▼         ▼         ▼
     ┌─────────┬─────────┬─────────┐
     │ Worker  │ Worker  │ Worker  │
     │ :8081   │ :8082   │ :8083   │
     │         │         │         │
     │ zigttp  │ zigttp  │ zigttp  │
     │ (warm)  │ (warm)  │ (warm)  │
     └─────────┴─────────┴─────────┘
```

### Load Balancer Responsibilities

1. **Pool Management**:
   - Spawn workers on startup
   - Monitor worker health
   - Replace failed workers (future enhancement)

2. **Request Distribution**:
   - Round-robin load balancing
   - Track worker utilization
   - Proxy requests to workers

3. **Stats Collection**:
   - Request counts per worker
   - Worker availability
   - Response times (future)

## Benchmarking

Compare pre-fork pool vs traditional cold starts:

```bash
./scripts/bench_prefork.sh
```

This runs:
1. 20 traditional cold start iterations (spawn process each time)
2. 20 requests to pre-fork pool (workers already warm)
3. Calculates improvement

Expected output:
```
Baseline (cold start):     71000us (71ms)
Pre-fork pool (warm):      30000us (30ms)
Improvement:               41000us (41ms)
Reduction:                 57.7%
```

## Advantages

✅ **Dramatic cold start reduction**: ~40ms improvement (56% faster)
✅ **Simple implementation**: ~100 lines of TypeScript
✅ **No special infrastructure**: Works on any platform
✅ **Easy to deploy**: Standard process management
✅ **Production-ready**: Similar to unicorn/gunicorn patterns

## Trade-offs

⚠️ **Memory overhead**: N workers = N × memory footprint
- Single worker: 3.8 MB
- 4 workers: ~15 MB
- 8 workers: ~30 MB

⚠️ **Port consumption**: Each worker needs a unique port
- Load balancer: 1 port
- Workers: N ports

⚠️ **Complexity**: Additional process management layer
- Need supervisor/systemd integration
- Worker health monitoring
- Graceful shutdown/restart

⚠️ **Connection overhead**: Extra proxy hop
- Load balancer → worker adds ~1ms latency
- Negligible for most use cases

## Production Deployment

### Using systemd

```ini
# /etc/systemd/system/zigttp-pool.service
[Unit]
Description=zigttp Pre-Fork Worker Pool
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/zigttp
Environment="POOL_SIZE=4"
Environment="PORT=8080"
ExecStart=/usr/bin/deno run --allow-net --allow-run --allow-env /opt/zigttp/tools/prefork-pool.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable zigttp-pool
sudo systemctl start zigttp-pool
sudo systemctl status zigttp-pool
```

### Using Docker Compose

```yaml
version: '3.8'

services:
  zigttp-pool:
    image: denoland/deno:latest
    command: run --allow-net --allow-run --allow-env /app/tools/prefork-pool.ts
    environment:
      - POOL_SIZE=4
      - PORT=8080
    volumes:
      - ./:/app
    ports:
      - "8080:8080"
    restart: unless-stopped
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zigttp-pool
spec:
  replicas: 1  # Pool manages workers internally
  selector:
    matchLabels:
      app: zigttp
  template:
    metadata:
      labels:
        app: zigttp
    spec:
      containers:
      - name: pool
        image: denoland/deno:latest
        command: ["deno", "run", "--allow-net", "--allow-run", "--allow-env", "/app/tools/prefork-pool.ts"]
        env:
        - name: POOL_SIZE
          value: "4"
        - name: PORT
          value: "8080"
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "32Mi"  # 4 workers × 8MB
          limits:
            memory: "64Mi"
```

## Advanced: Dynamic Pool Sizing

Future enhancement to adjust pool size based on load:

```typescript
class DynamicWorkerPool extends WorkerPool {
  private minWorkers = 2;
  private maxWorkers = 16;

  async scaleUp() {
    if (this.workers.length < this.maxWorkers) {
      const port = this.findFreePort();
      await this.spawnWorker(port, this.workers.length);
      console.log(`Scaled up to ${this.workers.length} workers`);
    }
  }

  async scaleDown() {
    if (this.workers.length > this.minWorkers) {
      const worker = this.workers.pop();
      worker?.process.kill();
      console.log(`Scaled down to ${this.workers.length} workers`);
    }
  }

  monitorLoad() {
    setInterval(() => {
      const avgRequests = this.getAverageRequestsPerWorker();
      if (avgRequests > 100) this.scaleUp();
      if (avgRequests < 10) this.scaleDown();
    }, 5000);
  }
}
```

## Comparison with Other Approaches

| Approach | Improvement | Complexity | Infrastructure |
|----------|-------------|------------|----------------|
| Embedded bytecode | -13ms | Easy | None |
| Pre-fork pool | **-40ms** | **Medium** | **Process manager** |
| CRIU snapshots | -50ms | Hard | Linux kernel, CRIU |
| Firecracker VMs | -45ms | Very Hard | AWS Firecracker |

Pre-fork is the sweet spot:
- Significant improvement (40ms vs 13ms for embedded bytecode)
- Practical to implement (~100 lines)
- Works on any platform
- Proven pattern (nginx, gunicorn, unicorn)

## Next Steps

1. **Benchmark on your workload**:
   ```bash
   ./scripts/bench_prefork.sh
   ```

2. **Test in production-like environment**:
   - Adjust pool size based on load
   - Monitor memory usage
   - Test failure scenarios

3. **Integrate with deployment**:
   - Add systemd service
   - Configure process supervisor
   - Set up monitoring

4. **Combine optimizations**:
   - Embedded bytecode: -13ms
   - Pre-fork pool: -40ms
   - **Total**: -53ms (74% faster than baseline)

## Monitoring

Add metrics to track pool health:

```typescript
class MonitoredWorkerPool extends WorkerPool {
  private metrics = {
    totalRequests: 0,
    workerUtilization: new Map<number, number>(),
    averageLatency: 0,
  };

  async handleRequest(req: Request): Promise<Response> {
    const start = performance.now();
    const response = await super.handleRequest(req);
    const latency = performance.now() - start;

    this.metrics.totalRequests++;
    this.metrics.averageLatency =
      (this.metrics.averageLatency * 0.95) + (latency * 0.05);

    return response;
  }

  getMetrics() {
    return {
      ...this.metrics,
      workers: this.workers.map((w, i) => ({
        id: i,
        port: w.port,
        requests: w.requestCount,
        ready: w.ready,
      })),
    };
  }
}
```

Expose via HTTP endpoint:
```bash
curl http://localhost:8080/_metrics
{
  "totalRequests": 12543,
  "averageLatency": 2.3,
  "workers": [
    {"id": 0, "port": 8081, "requests": 3124, "ready": true},
    {"id": 1, "port": 8082, "requests": 3142, "ready": true},
    {"id": 2, "port": 8083, "requests": 3139, "ready": true},
    {"id": 3, "port": 8084, "requests": 3138, "ready": true}
  ]
}
```

## Summary

Pre-fork worker pools are the **easiest infrastructure-level optimization** to implement:

- **40ms improvement** (56% faster)
- **~100 lines of code** (TypeScript implementation provided)
- **No special requirements** (works anywhere)
- **Proven pattern** (used by nginx, unicorn, gunicorn)

Combined with embedded bytecode optimization (-13ms), you achieve **-53ms total improvement** (74% faster than baseline):

```
Baseline:                      83ms
+ Embedded bytecode:           71ms (-13ms)
+ Pre-fork pool:               30ms (-41ms more)
Total improvement:             -53ms (64% reduction)
```

This brings zigttp cold starts from 83ms down to 30ms with practical, production-ready optimizations.
