// Array operations benchmark
// Tests array creation, access, and search operations

const ARRAY_OPS_ITERATIONS = 20000;

function runArrayOps(seed) {
    if (seed === undefined) seed = 0;
    let result = 0;

    for (let i of range(ARRAY_OPS_ITERATIONS)) {
        // Pattern 1: Array literal creation and element access
        const base = (i + seed) % 100;
        const arr = [base, base + 1, base + 2, base + 3, base + 4,
                     base + 5, base + 6, base + 7, base + 8, base + 9];
        result = (result + arr.length) % 1000000;

        // Pattern 2: Sequential element access
        for (let j of range(10)) {
            result = (result + arr[j]) % 1000000;
        }

        // Pattern 3: indexOf searches
        for (let k of range(5)) {
            const target = base + k * 2;
            const idx = arr.indexOf(target);
            if (idx >= 0) {
                result = (result + idx) % 1000000;
            }
        }

        // Pattern 4: includes checks
        for (let m of range(5)) {
            const target = base + m;
            if (arr.includes(target)) {
                result = (result + 1) % 1000000;
            }
        }

        // Pattern 5: join and string length
        const joined = arr.join(',');
        result = (result + joined.length) % 1000000;
    }
    return result;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runArrayOps = runArrayOps;
    globalThis.ARRAY_OPS_ITERATIONS = ARRAY_OPS_ITERATIONS;
}
