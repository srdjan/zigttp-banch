# zigttp Performance Work Items

Benchmark date: 2026-02-02. Measured on Apple M4 Pro, 14 cores, 24 GB RAM.
Comparison baseline: Deno 2.6.7 microbenchmarks from 2026-01-23 on same hardware.

Eight of fifteen microbenchmarks run below 10% of Deno throughput. They cluster into
four root causes, ordered by estimated impact.

---

## 1. Multi-argument String methods crash (queryParsing: 0.6% of Deno)

**Symptom:** `String.indexOf(needle, startPosition)` and `String.slice(start, end)` crash
when called with two arguments. Single-argument forms work fine.

**Impact:** The queryParsing benchmark must use character-by-character manual implementations
(`findChar` and `sliceStr` helper functions) instead of native builtins. This turns O(1)
native calls into O(n) JS loops, producing 76.8K ops/sec vs Deno's 13.7M ops/sec.

**Reproduction:**
```javascript
const str = 'page=1&limit=10&offset=0';
// This works:
str.indexOf('page');
// This crashes:
str.indexOf('&', 6);
// This crashes:
str.slice(5, 6);
```

**Fix scope:** The JS runtime's method dispatch for String builtins needs to handle the
second argument for at least `indexOf(needle, fromIndex)` and `slice(start, end)`.
Likely a single code path in the builtin string method handler.

**Benchmark file:** `microbench/benchmarks/query_parsing.js` - remove `findChar`/`sliceStr`
workarounds and use native methods once fixed.

---

## 2. String concatenation is slow in loops (stringBuild: 3.8%, stringOps: 9.2%)

**Symptom:** String concatenation with `+` operator runs 10-25x slower than Deno. No crashes,
just throughput. This is zigttp's most common operation in real FaaS handlers (building
response strings, URL construction, log messages).

**Measured numbers:**
- stringBuild: 4.52M ops/sec vs Deno 118.6M ops/sec (3.8%)
- stringOps: 13.9M ops/sec vs Deno 150.7M ops/sec (9.2%)

**What the benchmarks do:**
- stringBuild: chains of `'id=' + num + '&name=user' + num`, plus multi-step `s = s + '-'; s = s + val`
- stringOps: `str.indexOf(needle)` + `str.length` in a loop (no multi-arg, just volume)

**Likely cause:** String concatenation probably allocates a new string per `+` operation. V8 and
JSC use "rope" or "cons-string" representations that defer concatenation until the string is
actually read, making `+` nearly free in loops. A similar deferred strategy or at minimum a
pre-sized buffer for the result would close this gap significantly.

**Benchmark files:** `microbench/benchmarks/string_build.js`, `microbench/benchmarks/string_ops.js`

---

## 3. Builtin function dispatch overhead (parseInt: 8.4%, mathOps: 8.7%, functionCalls: 6.6%)

**Symptom:** Calling builtin functions (`parseInt`, `Math.floor/ceil/min/max/abs/round`) and
user-defined functions is 11-15x slower than Deno. No crashes, no workarounds needed.

**Measured numbers:**
- functionCalls: 16.5M ops/sec vs Deno 251.4M ops/sec (6.6%)
- parseInt: 10.6M ops/sec vs Deno 126.4M ops/sec (8.4%)
- mathOps: 15.0M ops/sec vs Deno 173.2M ops/sec (8.7%)

**What the benchmarks do:**
- functionCalls: two levels of user function calls (`compute -> add`) in a tight loop
- parseInt: four `parseInt(str, 10)` calls per iteration with pre-defined string constants
- mathOps: `Math.floor/ceil/round/min/max/abs` calls per iteration

**Likely cause:** Each function/builtin call probably goes through a generic dispatch path
(argument marshaling, scope lookup, return value boxing). V8 inlines these aggressively.
For zigttp, opportunities include:

1. Inline Math builtins as single Zig operations (e.g., `Math.floor(x)` becomes `@floor(x)`)
2. Reduce per-call overhead for user functions (avoid re-creating scope objects)
3. Recognize `parseInt(str, 10)` as a fast path since radix 10 is overwhelmingly common

**Benchmark files:** `microbench/benchmarks/function_calls.js`, `microbench/benchmarks/parse_int.js`, `microbench/benchmarks/math_ops.js`

---

## 4. Missing bracket notation and if-else chain limits (dynamicProps: 8.4%, arrayOps: 1.7%)

**Symptom:** Two separate but related issues:
- `obj[key]` bracket notation on objects is not supported, forcing if-else dispatch
- Long if-else chains (>4 branches) crash the runtime
- Array methods (`indexOf`, `includes`, `join`) are slow

**Measured numbers:**
- dynamicProps: 18.6M ops/sec vs Deno 220.8M ops/sec (8.4%) - reduced from 10 to 4 properties
- arrayOps: 113.9K ops/sec vs Deno 6.84M ops/sec (1.7%)

**dynamicProps details:** The original benchmark used 10 dynamic properties accessed via
`obj[key]`. Current workaround uses 4 properties with an if-else chain. The 8.4% ratio
reflects both the workaround overhead and general interpreter speed. Adding bracket notation
would let this benchmark run in its original form.

**arrayOps details:** Creates a 10-element array, then calls `indexOf`, `includes`, and `join`
per iteration. At 1.7% of Deno, this suggests array method implementations are doing linear
scans without optimization. The inner loop does 10 indexed reads + 5 indexOf calls + 5 includes
calls + 1 join call per outer iteration, so method dispatch overhead (item 3) compounds here.

**Reproduction for bracket notation:**
```javascript
const obj = { a: 1, b: 2 };
const key = 'a';
// This does not work:
obj[key];
// This works:
obj.a;
```

**Benchmark files:** `microbench/benchmarks/dynamic_props.js`, `microbench/benchmarks/array_ops.js`

---

## Priority Recommendation

| Priority | Work Item | Benchmarks Affected | Expected Impact |
|----------|-----------|--------------------|----|
| P0 | Fix multi-arg String methods | queryParsing | Removes 180x penalty from workaround |
| P1 | String concatenation perf | stringBuild, stringOps | Most common real-world operation |
| P1 | Builtin function inlining | parseInt, mathOps, functionCalls, arrayOps | Affects all compute-heavy workloads |
| P2 | Bracket notation `obj[key]` | dynamicProps | Enables idiomatic JS patterns |
| P2 | Longer if-else chain support | dynamicProps | Current 4-branch limit is restrictive |

P0 is a correctness bug (methods crash). P1 items are the biggest throughput wins for real
FaaS handlers. P2 items are JS completeness features that also improve benchmark parity.
