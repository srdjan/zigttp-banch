# Feature Comparison: zigttp vs Node.js vs Deno vs Bun

## Language Support

| Feature | zigttp | Node.js | Deno | Bun |
|---------|--------|---------|------|-----|
| ES5 Strict | Full | Full | Full | Full |
| ES6 (let/const/arrow) | Full | Full | Full | Full |
| ES6 (for-of/destructure) | Full | Full | Full | Full |
| ES6 (classes) | Partial | Full | Full | Full |
| ES6 (Promises) | None | Full | Full | Full |
| ES2020+ (optional chaining) | None | Full | Full | Full |
| TypeScript | Strip-only | Transpile | Native | Native |
| JSX | Native SSR | Transpile | Transpile | Native |
| TSX | Native | Transpile | Transpile | Native |

zigttp intentionally omits Promises and async/await. Handlers are synchronous, which simplifies the execution model for FaaS workloads where each request is isolated.

## API Coverage

| API | zigttp | Node.js | Deno | Bun |
|-----|--------|---------|------|-----|
| HTTP Server | Native | http module | Deno.serve | Bun.serve |
| Request/Response | Fetch-like | Manual | Fetch | Fetch |
| fetch() | Basic | Native | Native | Native |
| console | Full | Full | Full | Full |
| setTimeout | Partial | Full | Full | Full |
| File System | Partial | fs module | Deno.* | Bun.file |
| Crypto | None | Full | Full | Full |
| WebSocket | None | ws/native | Native | Native |
| Streams | None | Full | Full | Full |
| URL parsing | Basic | Full | Full | Full |
| JSON | Full | Full | Full | Full |

zigttp provides a minimal API surface optimized for HTTP request/response handling. Complex operations are expected to be handled by backend services.

## Ecosystem

| Aspect | zigttp | Node.js | Deno | Bun |
|--------|--------|---------|------|-----|
| npm packages | None | Full | Compatible | Full |
| ESM imports | None | Full | Full | Full |
| Package manager | None | npm/yarn/pnpm | deno | bun |

zigttp handlers are single-file. No module system means no dependency management overhead.

## Deployment Characteristics

| Metric | zigttp | Node.js | Deno | Bun |
|--------|--------|---------|------|-----|
| Binary Size | ~4MB | ~100MB+ | ~100MB+ | ~100MB+ |
| Cold Start | <1ms | 50-100ms | 30-50ms | 20-40ms |
| Memory Baseline | ~1MB | ~50MB | ~30MB | ~30MB |

zigttp compiles to a single static binary with zero dependencies. No JIT warmup required.

## Runtime Model

| Aspect | zigttp | Node.js | Deno | Bun |
|--------|--------|---------|------|-----|
| Request Isolation | RuntimePool | Process/Worker | Isolate | Worker |
| GC Model | Generational | V8 | V8 | JavaScriptCore |
| Async Model | Synchronous | Event Loop | Event Loop | Event Loop |

zigttp uses a lock-free RuntimePool with per-request arena allocation. Arenas reset in O(1) between requests. The synchronous execution model eliminates callback overhead and simplifies reasoning about request handling.

## Summary

zigttp trades breadth for depth: fewer features, but optimized for the FaaS use case. It excels at:
- Instant cold starts (<1ms)
- Minimal memory footprint
- Predictable performance (no JIT variance)
- Simple deployment (single binary)

Use zigttp when you need fast, isolated request handlers. Use Node.js/Deno/Bun when you need the full JavaScript ecosystem.
