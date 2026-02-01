// parseInt isolation benchmark
// Tests number parsing performance in isolation

const PARSE_INT_ITERATIONS = 20000;

function runParseInt(seed = 0) {
    let result = 0;

    // Pre-defined numeric strings to avoid string creation overhead
    const numStrs = ['0', '1', '42', '100', '999', '1234', '9999', '12345'];

    for (let i of range(PARSE_INT_ITERATIONS)) {
        const str = numStrs[(i + seed) % 8];

        // Pure parseInt calls
        const n1 = parseInt(str, 10);
        const n2 = parseInt(str, 10);
        const n3 = parseInt(str, 10);
        const n4 = parseInt(str, 10);

        result = (result + n1 + n2 + n3 + n4) % 1000000;
    }
    return result;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runParseInt = runParseInt;
    globalThis.PARSE_INT_ITERATIONS = PARSE_INT_ITERATIONS;
}
