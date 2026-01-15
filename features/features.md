# Feature Comparison: zigttp vs Deno

## Language Support

| Feature | zigttp | Deno |
|---------|--------|------|
| ES5 Strict | Full | Full |
| ES6 (let/const/arrow) | Full | Full |
| ES6 (for-of/destructure) | Full | Full |
| ES6 (classes) | Partial | Full |
| ES6 (Promises) | None | Full |
| ES2020+ (optional chaining) | None | Full |
| TypeScript | Strip-only | Native |
| JSX | Native SSR | Transpile |
| TSX | Native | Transpile |

zigttp intentionally omits Promises and async/await. Handlers are synchronous, which simplifies the execution model for FaaS workloads where each request is isolated.

## API Coverage

| API | zigttp | Deno |
|-----|--------|------|
| HTTP Server | Native | Deno.serve |
| Request/Response | Fetch-like | Fetch |
| fetch() | Basic | Native |
| console | Full | Full |
| setTimeout | Partial | Full |
| File System | Partial | Deno.* |
| Crypto | None | Full |
| WebSocket | None | Native |
| Streams | None | Full |
| URL parsing | Basic | Full |
| JSON | Full | Full |

zigttp provides a minimal API surface optimized for HTTP request/response handling. Complex operations are expected to be handled by backend services.

## Ecosystem

| Aspect | zigttp | Deno |
|--------|--------|------|
| npm packages | None | Compatible |
| ESM imports | None | Full |
| Package manager | None | deno |

zigttp handlers are single-file. No module system means no dependency management overhead.

## Deployment Characteristics

| Metric | zigttp | Deno |
|--------|--------|------|
| Binary Size | ~4MB | ~100MB+ |
| Cold Start | <1ms | 30-50ms |
| Memory Baseline | ~1MB | ~30MB |

zigttp compiles to a single static binary with zero dependencies. No JIT warmup required.

## Runtime Model

| Aspect | zigttp | Deno |
|--------|--------|------|
| Request Isolation | RuntimePool | Isolate |
| GC Model | Generational | V8 |
| Async Model | Synchronous | Event Loop |

zigttp uses a lock-free RuntimePool with per-request arena allocation. Arenas reset in O(1) between requests. The synchronous execution model eliminates callback overhead and simplifies reasoning about request handling.

## Summary

zigttp trades breadth for depth: fewer features, but optimized for the FaaS use case. It excels at:
- Instant cold starts (<1ms)
- Minimal memory footprint
- Predictable performance (no JIT variance)
- Simple deployment (single binary)

Use zigttp when you need fast, isolated request handlers. Use Deno when you need the full JavaScript ecosystem.
