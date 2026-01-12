// Microbenchmark suite entrypoint

const runtime = typeof detectRuntime === 'function' ? detectRuntime() : 'unknown';
const rawFilter = typeof __benchFilter !== 'undefined' ? ('' + __benchFilter) : '';
const hasFilter = rawFilter !== '';

let filterArithmetic = false;
let filterStringOps = false;
let filterObjectCreate = false;
let filterPropertyAccess = false;
let filterFunctionCalls = false;
let filterJsonOps = false;
let filterHttpHandler = false;
let filterHttpHandlerHeavy = false;

if (hasFilter) {
    let start = 0;
    let done = false;
    for (let _ of range(rawFilter.length + 1)) {
        if (!done) {
            const idx = rawFilter.indexOf(',', start);
            const name = idx === -1 ? rawFilter.slice(start) : rawFilter.slice(start, idx);
            if (name === 'arithmetic') {
                filterArithmetic = true;
            } else if (name === 'stringOps') {
                filterStringOps = true;
            } else if (name === 'objectCreate') {
                filterObjectCreate = true;
            } else if (name === 'propertyAccess') {
                filterPropertyAccess = true;
            } else if (name === 'functionCalls') {
                filterFunctionCalls = true;
            } else if (name === 'jsonOps') {
                filterJsonOps = true;
            } else if (name === 'httpHandler') {
                filterHttpHandler = true;
            } else if (name === 'httpHandlerHeavy') {
                filterHttpHandlerHeavy = true;
            }
            if (idx === -1) {
                done = true;
            } else {
                start = idx + 1;
            }
        }
    }
}

const results = {};

function runBench(name, fn, iterations) {
    if (typeof fn !== 'function' || !iterations) {
        return { name: name, error: 'missing benchmark', runtime: runtime };
    }
    const result = benchmark(name, fn, iterations);
    result.runtime = runtime;
    return result;
}

if (!hasFilter || filterArithmetic) {
    results.arithmetic = runBench('arithmetic', runArithmetic, ARITHMETIC_ITERATIONS);
}
if (!hasFilter || filterStringOps) {
    results.stringOps = runBench('stringOps', runStringOps, STRING_OPS_ITERATIONS);
}
if (!hasFilter || filterObjectCreate) {
    results.objectCreate = runBench('objectCreate', runObjectCreate, OBJECT_CREATE_ITERATIONS);
}
if (!hasFilter || filterPropertyAccess) {
    results.propertyAccess = runBench('propertyAccess', runPropertyAccess, PROPERTY_ACCESS_ITERATIONS);
}
if (!hasFilter || filterFunctionCalls) {
    results.functionCalls = runBench('functionCalls', runFunctionCalls, FUNCTION_CALLS_ITERATIONS);
}
if (!hasFilter || filterJsonOps) {
    results.jsonOps = runBench('jsonOps', runJsonOps, JSON_OPS_ITERATIONS);
}
if (!hasFilter || filterHttpHandler) {
    results.httpHandler = runBench('httpHandler', runHttpHandler, HTTP_HANDLER_ITERATIONS);
}
if (!hasFilter || filterHttpHandlerHeavy) {
    results.httpHandlerHeavy = runBench('httpHandlerHeavy', runHttpHandlerHeavy, HTTP_HANDLER_HEAVY_ITERATIONS);
}

console.log(JSON.stringify(results, null, 2));
