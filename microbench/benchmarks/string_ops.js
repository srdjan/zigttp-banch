// String operations benchmark
// Tests indexOf and length operations

const STRING_OPS_ITERATIONS = 20000;

function runStringOps(seed = 0) {
    const str = 'The quick brown fox jumps over the lazy dog';
    const needle = (seed & 1) ? 'fox' : 'dog';
    let count = 0;
    for (let _ of range(STRING_OPS_ITERATIONS)) {
        count = (count + str.indexOf(needle)) % 1000000;
        count = (count + str.length + (seed & 7)) % 1000000;
    }
    return count;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runStringOps, INNER_ITERATIONS: STRING_OPS_ITERATIONS, name: 'stringOps' };
}
if (typeof globalThis !== 'undefined') {
    globalThis.runStringOps = runStringOps;
    globalThis.STRING_OPS_ITERATIONS = STRING_OPS_ITERATIONS;
}
