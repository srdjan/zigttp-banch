// Microbenchmark suite entrypoint

const runtime = typeof detectRuntime === 'function' ? detectRuntime() : 'unknown';
const rawFilter = typeof __benchFilter !== 'undefined' ? ('' + __benchFilter) : '';
const hasFilter = rawFilter !== '';

// Filter check using indexOf + substring boundary verification
// NOTE: zigttp has a bug where string concat inside functions swaps operands
// when one operand is a function parameter. We avoid concat entirely by using
// substring() to check comma boundaries around indexOf matches.
const shouldRun = (name) => {
    if (!hasFilter) return true;
    if (rawFilter === name) return true;
    const idx = rawFilter.indexOf(name);
    if (idx === -1) return false;
    const nameLen = name.length;
    const filterLen = rawFilter.length;
    let leftOk = (idx === 0);
    if (!leftOk && idx > 0) {
        leftOk = (rawFilter.substring(idx - 1, idx) === ',');
    }
    const endPos = idx + nameLen;
    let rightOk = (endPos === filterLen);
    if (!rightOk && endPos < filterLen) {
        rightOk = (rawFilter.substring(endPos, endPos + 1) === ',');
    }
    if (leftOk && rightOk) return true;
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
    results.arrayOps = runBench('arrayOps', runArrayOps, ARRAY_OPS_ITERATIONS);
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
if (shouldRun('monoProperty')) {
    results.monoProperty = runBench('monoProperty', runMonoProperty, MONO_PROPERTY_ITERATIONS);
}
if (shouldRun('monoPropertyWrite')) {
    results.monoPropertyWrite = runBench('monoPropertyWrite', runMonoPropertyWrite, MONO_PROPERTY_WRITE_ITERATIONS);
}

console.log(JSON.stringify(results, null, 2));
