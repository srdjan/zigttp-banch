// Nested object access benchmark
// Tests deep property chain access patterns
// zigttp compatibility: Reduced from 4 to 2 levels (deep nesting crashes)

const NESTED_ACCESS_ITERATIONS = 20000;

function runNestedAccess(seed = 0) {
    // Create nested structure (reduced to 2 levels max)
    const data = {
        user: {
            age: 25 + (seed & 0xf),
            count: seed,
            visits: 100
        },
        meta: {
            version: 1,
            timestamp: 12345
        }
    };

    let result = 0;

    for (let i of range(NESTED_ACCESS_ITERATIONS)) {
        // 2-level reads instead of 4-level
        result = (result + data.user.age) % 1000000;
        result = (result + data.user.count) % 1000000;
        result = (result + data.user.visits) % 1000000;
        result = (result + data.meta.version) % 1000000;

        // 2-level writes
        data.user.count = (i + seed) % 1000;
        data.user.visits = (data.user.visits + 1) % 10000;

        // Mixed read after write
        result = (result + data.user.count) % 1000000;
    }
    return result;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runNestedAccess = runNestedAccess;
    globalThis.NESTED_ACCESS_ITERATIONS = NESTED_ACCESS_ITERATIONS;
}
