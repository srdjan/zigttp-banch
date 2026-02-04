// Monomorphic property access benchmark
// Tests object property read performance with guaranteed single hidden class
// This benchmark is designed to measure the fast path of emitMonomorphicGetField

const MONO_PROPERTY_ITERATIONS = 20000;

// Single object created once, never modified after creation
// This ensures the hidden class stays stable throughout
function runMonoProperty(seed = 0) {
    const obj = { x: 1, y: 2, z: 3 };
    let sum = seed;
    for (let i of range(MONO_PROPERTY_ITERATIONS)) {
        // Read-only access to properties - no writes that could change shape
        sum = (sum + obj.x + obj.y + obj.z) | 0;
    }
    return sum;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runMonoProperty = runMonoProperty;
    globalThis.MONO_PROPERTY_ITERATIONS = MONO_PROPERTY_ITERATIONS;
}
