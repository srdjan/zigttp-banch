// Microbenchmark suite entrypoint

const runtime = typeof detectRuntime === 'function' ? detectRuntime() : 'unknown';

const BENCHES = [
    { name: 'arithmetic', fn: globalThis.runArithmetic, iterations: globalThis.ARITHMETIC_ITERATIONS },
    { name: 'stringOps', fn: globalThis.runStringOps, iterations: globalThis.STRING_OPS_ITERATIONS },
    { name: 'objectCreate', fn: globalThis.runObjectCreate, iterations: globalThis.OBJECT_CREATE_ITERATIONS },
    { name: 'propertyAccess', fn: globalThis.runPropertyAccess, iterations: globalThis.PROPERTY_ACCESS_ITERATIONS },
    { name: 'functionCalls', fn: globalThis.runFunctionCalls, iterations: globalThis.FUNCTION_CALLS_ITERATIONS },
    { name: 'jsonOps', fn: globalThis.runJsonOps, iterations: globalThis.JSON_OPS_ITERATIONS },
    { name: 'httpHandler', fn: globalThis.runHttpHandler, iterations: globalThis.HTTP_HANDLER_ITERATIONS }
];

const results = {};

for (const bench of BENCHES) {
    if (typeof bench.fn !== 'function' || !bench.iterations) {
        results[bench.name] = { name: bench.name, error: 'missing benchmark', runtime };
        continue;
    }
    const result = benchmark(bench.name, bench.fn, bench.iterations);
    result.runtime = runtime;
    results[bench.name] = result;
}

console.log(JSON.stringify(results, null, 2));
