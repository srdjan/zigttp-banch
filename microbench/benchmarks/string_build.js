// String building benchmark
// Tests various patterns for constructing strings

const STRING_BUILD_ITERATIONS = 10000;

function runStringBuild(seed = 0) {
    let result = 0;

    for (let i of range(STRING_BUILD_ITERATIONS)) {
        // Pattern 1: Concatenation chain
        let s1 = 'id=' + ((i + seed) % 100) + '&name=user' + (seed & 7);
        result = (result + s1.length) % 1000000;

        // Pattern 2: Multiple concatenations
        let s2 = 'prefix';
        s2 = s2 + '-';
        s2 = s2 + ((i * seed) % 50);
        s2 = s2 + '-suffix';
        result = (result + s2.length) % 1000000;

        // Pattern 3: Building with array join (if supported)
        // Simulated with concat for now
        let parts = 'a' + ',' + 'b' + ',' + 'c' + ',' + ((seed + i) % 10);
        result = (result + parts.length) % 1000000;
    }
    return result;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runStringBuild = runStringBuild;
    globalThis.STRING_BUILD_ITERATIONS = STRING_BUILD_ITERATIONS;
}
