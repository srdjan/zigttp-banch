# Benchmark History

Tracking zigttp performance relative to Deno across optimization efforts.

## Latest Results: 2026-02-04

### Microbenchmarks

| Benchmark | Deno | zigttp | Ratio | Delta |
|-----------|------|--------|-------|-------|
| monoProperty | 1,038M | 60.3M | 0.06x | -94.2% |
| monoPropertyWrite | 957M | 44.0M | 0.05x | -95.4% |
| functionCalls | 330M | 22.2M | 0.07x | -93.3% |
| propertyAccess | 304M | 37.2M | 0.12x | -87.7% |
| dynamicProps | 305M | 22.2M | 0.07x | -92.7% |
| objectCreate | 272M | 11.7M | 0.04x | -95.7% |
| mathOps | 213M | 16.6M | 0.08x | -92.2% |
| stringOps | 174M | 21.6M | 0.12x | -87.6% |
| parseInt | 158M | 14.6M | 0.09x | -90.8% |
| stringBuild | 124M | 5.9M | 0.05x | -95.3% |
| arithmetic | 111M | 28.5M | 0.26x | -74.3% |
| nestedAccess | 76M | 10.1M | 0.13x | -86.7% |
| httpHandler | 24.3M | 6.5M | 0.27x | -73.3% |
| arrayOps | 4.3M | 245K | 0.06x | -94.4% |
| queryParsing | 3.9M | 3.9M | 1.00x | -0.4% |
| jsonOps | 3.4M | 3.1M | 0.91x | -8.7% |
| httpHandlerHeavy | 2.5M | 3.0M | **1.22x** | **+21.9%** |

### Cold Start

| Runtime | Mean | Median | p99 |
|---------|------|--------|-----|
| Deno | 37ms | 35ms | 49ms |
| zigttp | 102ms | 102ms | 104ms |

### Memory

| Runtime | Baseline | Peak |
|---------|----------|------|
| Deno | ~45 MB | ~65 MB |
| zigttp | 4.3 MB | 10.8 MB |

## Analysis

### Where zigttp Wins

1. **httpHandlerHeavy (+22%)**: zigttp's FaaS-optimized architecture shines on heavy handler workloads
2. **queryParsing (parity)**: Native string methods restored after zigttp fixes
3. **jsonOps (-9%)**: Near parity on JSON operations
4. **Memory (10x smaller)**: 4.3 MB vs ~45 MB baseline RSS

### Where zigttp Trails

1. **Property access operations**: V8's hidden classes and inline caches are highly optimized
2. **String operations**: V8's rope strings and optimized concatenation
3. **Math operations**: V8's speculative optimization and deoptimization

### Known Limitations

- **dynamicProps**: Limited to 8 branches (9+ causes JIT crash) - see `docs/pending_zigttp_fixes.md`
- **Cold start**: 102ms vs 37ms - zigttp trades startup time for memory efficiency

## Historical Snapshots

### 2026-02-04 (Current)

Key changes since baseline:
- Restored `nestedAccess` to 4-level nesting (was 2-level workaround)
- Restored `queryParsing` native implementation (was manual workaround)
- Improved `dynamicProps` from 4 to 8 branches
- Added `monoProperty` and `monoPropertyWrite` benchmarks

### 2026-02-02 (Baseline)

Initial full benchmark run with Deno 2.6.7 baselines established.

## Updating This Document

After running benchmarks:

```bash
# Run zigttp benchmarks
deno run -A bench.ts full zigttp

# Compare to baseline
deno run -A bench.ts compare results/<timestamp>
```

Copy the comparison output and update the tables above with new results.
