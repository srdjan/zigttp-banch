// Nested object access benchmark
// Tests deep property chain access patterns

const NESTED_ACCESS_ITERATIONS = 20000;

function runNestedAccess(seed = 0) {
    // Create nested structure
    const data = {
        user: {
            profile: {
                name: 'test',
                age: 25 + (seed & 0xf),
                settings: {
                    theme: 'dark',
                    notifications: true,
                    count: seed
                }
            },
            stats: {
                visits: 100,
                posts: 50
            }
        },
        meta: {
            version: 1,
            timestamp: 12345
        }
    };

    let result = 0;

    for (let i of range(NESTED_ACCESS_ITERATIONS)) {
        // Deep reads (3-4 levels)
        result = (result + data.user.profile.age) % 1000000;
        result = (result + data.user.profile.settings.count) % 1000000;
        result = (result + data.user.stats.visits) % 1000000;
        result = (result + data.meta.version) % 1000000;

        // Deep writes
        data.user.profile.settings.count = (i + seed) % 1000;
        data.user.stats.visits = (data.user.stats.visits + 1) % 10000;

        // Mixed read after write
        result = (result + data.user.profile.settings.count) % 1000000;
    }
    return result;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runNestedAccess, INNER_ITERATIONS: NESTED_ACCESS_ITERATIONS, name: 'nestedAccess' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runNestedAccess = runNestedAccess;
    globalThis.NESTED_ACCESS_ITERATIONS = NESTED_ACCESS_ITERATIONS;
}
