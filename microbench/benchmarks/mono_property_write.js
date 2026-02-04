// Monomorphic property write benchmark
// Tests object property write performance with guaranteed single hidden class

const MONO_PROPERTY_WRITE_ITERATIONS = 20000;

// Single object type, testing writes to existing properties only
// No new property additions that could change the hidden class
function runMonoPropertyWrite(seed = 0) {
    const obj = { x: 1, y: 2, z: 3 };
    let sum = seed;
    for (let i of range(MONO_PROPERTY_WRITE_ITERATIONS)) {
        // Write to existing properties only
        obj.x = i;
        obj.y = i + 1;
        obj.z = i + 2;
        sum = (sum + obj.x) | 0;
    }
    return sum;
}

if (typeof globalThis !== 'undefined') {
    globalThis.runMonoPropertyWrite = runMonoPropertyWrite;
    globalThis.MONO_PROPERTY_WRITE_ITERATIONS = MONO_PROPERTY_WRITE_ITERATIONS;
}
