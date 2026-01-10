# zigttp Benchmark Results

**Generated:** 2026-01-10 14:43:39

## System Information

- **OS:** Darwin 25.1.0
- **CPU:** Apple M4 Pro
- **Cores:** 14
- **RAM:** 24 GB

### Runtime Versions

- **node:** v22.21.0
- **deno:** 2.6.4
- **bun:** not installed

## HTTP Benchmark Results

| Runtime | Endpoint | RPS | p99 Latency |
|---------|----------|-----|-------------|
| deno | /api/echo | 23,786 | 0.0001s |
| deno | /api/greet/world | 25,035 | 0.0001s |
| deno | /api/health | 24,912 | 0.0001s |
| node | /api/echo | 23,799 | 0.0001s |
| node | /api/greet/world | 25,039 | 0.0001s |
| node | /api/health | 24,966 | 0.0001s |
| zigttp | /api/echo | 23,824 | 0.0001s |
| zigttp | /api/greet/world | 25,062 | 0.0001s |
| zigttp | /api/health | 24,998 | 0.0001s |

## Methodology

See [methodology.md](../methodology.md) for detailed test methodology.
