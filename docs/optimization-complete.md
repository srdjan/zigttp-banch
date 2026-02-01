# Performance Optimization Plan for zts - COMPLETED

## Overview

Multi-phase plan to close the performance gap between zigttp and Deno. All 9 phases have been implemented.

---

## Benchmark Baseline (ops/sec) - Before Optimization

| Benchmark | Deno | zigttp | Gap |
|-----------|------|--------|-----|
| mathOps | 152,049,439 | 3,655,046 | 41.6x |
| stringBuild | 109,363,381 | 2,954,574 | 37.0x |
| dynamicProps | 32,549,003 | 1,181,199 | 27.6x |
| parseInt | 41,779,851 | 2,745,119 | 15.2x |
| objectCreate | 52,102,665 | 4,538,058 | 11.5x |
| functionCalls | 135,024,789 | 13,389,040 | 10.1x |
| arrayOps | 56,093,085 | 6,152,890 | 9.1x |
| queryParse | 2,612,970 | 296,428 | 8.8x |
| arithmetic | 101,275,139 | 15,047,929 | 6.7x |
| httpHandlerHeavy | 2,568,073 | 1,293,458 | 2.0x |
| jsonOps | 2,960,010 | 2,920,962 | 1.0x |

---

## Phase 1: Float Boxing Elimination - COMPLETED

**Target**: mathOps (41.6x gap)

**Root Cause**: `JSValue.fromInlineFloat()` had precision check that forced heap allocation when f64 cannot round-trip through f32.

**Solution**: Use NaN-boxing to store all f64 values inline without heap allocation.

**Files Modified**:
- `zts/value.zig` - New NaN-boxing scheme using quiet NaN space for tagged pointers

**Changes**:
```zig
// New representation: use quiet NaN space for tags
// All f64 values stored inline - no heap allocation
pub fn fromFloat(val: f64) JSValue {
    const bits: u64 = @bitCast(val);
    if ((bits & 0xFFF8_0000_0000_0000) == 0xFFF8_0000_0000_0000) {
        return .{ .val = CANONICAL_NAN };
    }
    return .{ .val = bits };
}
```

---

## Phase 2: String Rope Implementation - COMPLETED

**Target**: stringBuild (37.0x gap)

**Root Cause**: Each string concatenation allocated new flat buffer and copied both operands (O(n^2) for n concatenations).

**Solution**: Lazy rope evaluation - concatenation is O(1), flatten only when needed.

**Files Modified**:
- `zts/string_pool.zig` - Added RopeNode type
- `zts/value.zig` - String tag points to rope or flat
- `zts/builtins.zig` - Updated string methods to handle ropes

---

## Phase 3: Polymorphic Inline Cache - COMPLETED

**Target**: dynamicProps (27.6x gap)

**Root Cause**: Only monomorphic IC existed - cache miss fell back to slow hash lookup.

**Solution**: Check 4 PIC entries instead of just 1 before falling back to slow path.

**Files Modified**:
- `zts/interpreter.zig` - Made `PICEntry` public
- `zts/jit/baseline.zig` - Added PIC constants and rewrote IC functions

**Changes**:
```zig
const PIC_ENTRY_SIZE: i32 = @intCast(@sizeOf(PICEntry));
const PIC_CHECK_COUNT: i32 = 4;

// emitGetFieldIC and emitPutFieldIC now check 4 entries:
// Check entry 0, if miss check entry 1, etc., then fall to slow path
```

---

## Phase 4: parseInt SIMD Optimization - COMPLETED

**Target**: parseInt (15.2x gap)

**Root Cause**: Character-by-character parsing with bounds checks per digit.

**Solution**: SWAR (SIMD Within A Register) to process 8 digits in parallel.

**Files Modified**:
- `zts/builtins.zig` - Added SWAR helpers and optimized `numberParseInt`

**Changes**:
```zig
/// SWAR helper: check if all 8 bytes are ASCII digits
inline fn swarAllDigits(chunk: u64) bool {
    const zeroed = chunk -% 0x3030303030303030;
    const check = (zeroed +% 0x7676767676767676) | zeroed;
    return (check & 0x8080808080808080) == 0;
}

/// SWAR helper: convert 8 ASCII digit bytes to integer
inline fn swarToInt(chunk: u64) u64 {
    const digits = chunk -% 0x3030303030303030;
    // Extract all 8 digits and combine with place values
    ...
}

// Also added 4-byte versions: swar4AllDigits, swar4ToInt
// numberParseInt now processes 8 then 4 digits at a time for radix 10
```

---

## Phase 5: Function Inlining Optimizations - COMPLETED

**Target**: functionCalls (10.1x gap)

**Root Cause**: Every call went through full dispatch even for hot monomorphic call sites.

**Solution**: More aggressive inlining for tiny functions.

**Files Modified**:
- `zts/type_feedback.zig` - Added TINY_FUNCTION_SIZE threshold

**Changes**:
```zig
/// Tiny function threshold - inline immediately with just 1 call
pub const TINY_FUNCTION_SIZE: u32 = 16;

// In shouldInline():
const min_calls: u32 = if (callee.code.len <= TINY_FUNCTION_SIZE)
    1  // Inline tiny functions after just 1 call
else if (callee.execution_count > HOT_CALLEE_THRESHOLD)
    MIN_CALL_COUNT_HOT
else
    MIN_CALL_COUNT;
```

---

## Phase 6: AIR Lowering Integration - COMPLETED

**Target**: arithmetic (6.7x gap)

**Status**: Already implemented via optimized JIT tier with loop-level guards, unboxed arithmetic, and register allocation.

---

## Phase 7: Object Creation Fast Path - COMPLETED

**Target**: objectCreate (11.5x gap)

**Root Cause**: Object literal creation allocated shape + slots separately with no pooling.

**Solution**: Compile-time unrolled initialization for small objects, uninit variant for immediate writes.

**Files Modified**:
- `zts/object.zig` - Optimized createWithArenaFast, added createWithArenaUninit

**Changes**:
```zig
pub fn createWithArenaFast(...) ?*JSObject {
    // Initialize slots - use compile-time unrolling for common small counts
    const count = @min(slot_count, INLINE_SLOT_COUNT);
    if (count <= 4) {
        comptime var i: usize = 0;
        inline while (i < 4) : (i += 1) {
            if (i < count) obj.inline_slots[i] = value.JSValue.undefined_val;
        }
    } else {
        for (0..count) |i| {
            obj.inline_slots[i] = value.JSValue.undefined_val;
        }
    }
    return obj;
}

/// Create object skipping slot initialization (caller must fill them)
pub fn createWithArenaUninit(...) ?*JSObject {
    // Header only, slots uninitialized
}
```

---

## Phase 8: Array Operations Optimization - COMPLETED

**Target**: arrayOps (9.1x gap)

**Root Cause**: Array methods went through generic property path with bounds checking on every access.

**Solution**: Specialized unchecked access methods after upfront validation.

**Files Modified**:
- `zts/object.zig` - Added createArrayWithArenaUninit, setIndexUnchecked
- `zts/builtins.zig` - Optimized array methods

**Changes**:
```zig
// object.zig
pub fn createArrayWithArenaUninit(arena, class_idx, length) ?*JSObject {
    // Only initialize length slot - element slots will be written by caller
}

pub inline fn setIndexUnchecked(self: *JSObject, index: u32, val: value.JSValue) void {
    const slot = index + 1;
    if (slot < INLINE_SLOT_COUNT) {
        self.inline_slots[slot] = val;
    } else {
        self.overflow_slots.?[slot - INLINE_SLOT_COUNT] = val;
    }
}

// builtins.zig - arrayIndexOf, arrayIncludes, arrayJoin, arrayToReversed, arrayToSorted
// Now use getIndexUnchecked after upfront class_id validation
```

---

## Phase 9: Query String Parsing Optimization - COMPLETED

**Target**: queryParse (8.8x gap)

**Root Cause**: Repeated string allocations and character-by-character parsing.

**Solution**: Single-character fast path for indexOf, arena allocation for temporary strings.

**Files Modified**:
- `zts/builtins.zig` - Multiple string method optimizations

**Changes**:
```zig
// stringIndexOf - single character fast path
if (needle_data.len == 1) {
    if (std.mem.indexOfScalar(u8, search_area, needle_data[0])) |rel_idx| {
        return value.JSValue.fromInt(@intCast(start + rel_idx));
    }
    return value.JSValue.fromInt(-1);
}

// Integer position extraction optimized
if (pos_arg.isInt()) {
    const pos = pos_arg.getInt();
    start = if (pos >= 0) @intCast(pos) else 0;
}

// Updated to use ctx.createStringPtr for arena allocation:
// - stringSlice
// - stringSubstring
// - stringTrim, stringTrimStart, stringTrimEnd
// - stringSplit
// - arrayJoin
```

---

## Verification Commands

After optimization, run benchmarks to verify improvements:

```bash
cd /Users/srdjans/Code/zigttp-bench

# Single benchmark
deno run -A bench.ts micro zigttp --filter=mathOps

# Full benchmark suite
deno run -A bench.ts full

# Quick validation
deno run -A bench.ts quick
```

---

## Expected Results After Optimization

| Phase | Target | Original Gap | Expected After |
|-------|--------|--------------|----------------|
| 1 | mathOps | 41.6x | ~2-3x |
| 2 | stringBuild | 37.0x | ~2-4x |
| 3 | dynamicProps | 27.6x | ~3-5x |
| 4 | parseInt | 15.2x | ~2-3x |
| 5 | functionCalls | 10.1x | ~2-3x |
| 6 | arithmetic | 6.7x | ~1.5-2x |
| 7 | objectCreate | 11.5x | ~2-3x |
| 8 | arrayOps | 9.1x | ~2-3x |
| 9 | queryParse | 8.8x | ~2-3x |

---

## Implementation Status

All phases completed on 2026-01-25.

Key files modified:
- `zts/value.zig` - NaN-boxing
- `zts/string_pool.zig` - String ropes
- `zts/interpreter.zig` - PICEntry export
- `zts/jit/baseline.zig` - Polymorphic IC
- `zts/builtins.zig` - SWAR parseInt, array methods, string methods
- `zts/type_feedback.zig` - Inlining thresholds
- `zts/object.zig` - Object/array creation fast paths
