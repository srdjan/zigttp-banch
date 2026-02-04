# Pending zigttp Fixes

Tracking document for zigttp bugs that require workarounds in benchmarks.

## JIT Crash with 9+ If-Else Branches

**Status**: Pending zigttp fix
**Date identified**: 2026-02-04
**Severity**: Medium (workaround available)

### Issue

Functions with 9 or more if-else branches crash (segfault, exit 139) when called 150+ times. The exact threshold is 9 branches - 8 works reliably.

### Reproduction

```javascript
// This crashes when called 150+ times:
function crasher(seed) {
    const idx = seed % 9;
    if (idx === 0) { return 0; }
    else if (idx === 1) { return 1; }
    else if (idx === 2) { return 2; }
    else if (idx === 3) { return 3; }
    else if (idx === 4) { return 4; }
    else if (idx === 5) { return 5; }
    else if (idx === 6) { return 6; }
    else if (idx === 7) { return 7; }
    else { return 8; }  // 9th branch
}

for (let i of range(150)) { crasher(i); }  // CRASH
```

### Affected Benchmarks

- `dynamicProps`: Reduced from 10 to 8 branches
  - Original: 10 if-else branches covering properties p0-p9
  - Workaround: 8 branches covering p0-p7 (80% coverage)
  - Performance impact: ~22M ops/sec (vs theoretical ~25-30M with 10 branches)

### When Fixed

When zigttp fixes this issue:

1. Update `microbench/benchmarks/dynamic_props.js`:
   - Restore original 10-branch version from git history:
     ```bash
     git show 55bde1d^:microbench/benchmarks/dynamic_props.js
     ```
   - Or restore from `git show ae13732^:microbench/benchmarks/dynamic_props.js` for pre-fix version

2. Update `CLAUDE.md`:
   - Move dynamicProps from "Adapted" to "Native Support" section
   - Update regression status table

3. Run validation:
   ```bash
   deno run -A bench.ts micro zigttp --filter=dynamicProps
   ```

4. Remove this tracking item from pending fixes

### Technical Notes

The crash appears to be in the JIT compilation phase, not interpretation. Likely causes:
- Register allocation overflow with many branch targets
- Jump table generation bug
- IR lowering issue with large control flow graphs

The crash is deterministic and occurs at the same call count threshold regardless of:
- Inner loop iterations
- Property access patterns
- Timing (performance.now) usage
