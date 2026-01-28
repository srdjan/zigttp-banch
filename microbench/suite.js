// Microbenchmark suite entrypoint

const runtime = typeof detectRuntime === 'function' ? detectRuntime() : 'unknown';
const rawFilter = typeof __benchFilter !== 'undefined' ? ('' + __benchFilter) : '';
const hasFilter = rawFilter !== '';

// Simple filter check using indexOf (zigttp-compatible, no Set/includes)
const shouldRun = (name) => {
    if (!hasFilter) return true;
    // Check if name appears in comma-separated filter list
    // Handle: exact match, start of string, end of string, middle
    const needle = name;
    const haystack = rawFilter;
    if (haystack === needle) return true;
    if (haystack.indexOf(needle + ',') === 0) return true;
    if (haystack.indexOf(',' + needle) === haystack.length - needle.length - 1) return true;
    if (haystack.indexOf(',' + needle + ',') !== -1) return true;
    return false;
};

const results = {};

function runBench(name, fn, iterations) {
    if (typeof fn !== 'function' || !iterations) {
        return { name: name, error: 'missing benchmark', runtime: runtime };
    }
    const result = benchmark(name, fn, iterations);
    result.runtime = runtime;
    return result;
}

if (shouldRun('arithmetic')) {
    results.arithmetic = runBench('arithmetic', runArithmetic, ARITHMETIC_ITERATIONS);
}
if (shouldRun('stringOps')) {
    results.stringOps = runBench('stringOps', runStringOps, STRING_OPS_ITERATIONS);
}
if (shouldRun('objectCreate')) {
    results.objectCreate = runBench('objectCreate', runObjectCreate, OBJECT_CREATE_ITERATIONS);
}
if (shouldRun('propertyAccess')) {
    results.propertyAccess = runBench('propertyAccess', runPropertyAccess, PROPERTY_ACCESS_ITERATIONS);
}
if (shouldRun('functionCalls')) {
    results.functionCalls = runBench('functionCalls', runFunctionCalls, FUNCTION_CALLS_ITERATIONS);
}
if (shouldRun('jsonOps')) {
    results.jsonOps = runBench('jsonOps', runJsonOps, JSON_OPS_ITERATIONS);
}
if (shouldRun('httpHandler')) {
    results.httpHandler = runBench('httpHandler', runHttpHandler, HTTP_HANDLER_ITERATIONS);
}
if (shouldRun('httpHandlerHeavy')) {
    results.httpHandlerHeavy = runBench('httpHandlerHeavy', runHttpHandlerHeavy, HTTP_HANDLER_HEAVY_ITERATIONS);
}
if (shouldRun('stringBuild')) {
    results.stringBuild = runBench('stringBuild', runStringBuild, STRING_BUILD_ITERATIONS);
}
if (shouldRun('dynamicProps')) {
    results.dynamicProps = runBench('dynamicProps', runDynamicProps, DYNAMIC_PROPS_ITERATIONS);
}
if (shouldRun('arrayOps')) {
    if (runtime !== 'zigttp') {
        results.arrayOps = runBench('arrayOps', runArrayOps, ARRAY_OPS_ITERATIONS);
    }
}
if (shouldRun('nestedAccess')) {
    results.nestedAccess = runBench('nestedAccess', runNestedAccess, NESTED_ACCESS_ITERATIONS);
}
if (shouldRun('queryParsing')) {
    results.queryParsing = runBench('queryParsing', runQueryParsing, QUERY_PARSING_ITERATIONS);
}
if (shouldRun('parseInt')) {
    results.parseInt = runBench('parseInt', runParseInt, PARSE_INT_ITERATIONS);
}
if (shouldRun('mathOps')) {
    results.mathOps = runBench('mathOps', runMathOps, MATH_OPS_ITERATIONS);
}

console.log(JSON.stringify(results, null, 2));
