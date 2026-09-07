const LINEAR_REGEX_FLAGS = "u";
type RE2Module = typeof import("re2-wasm");
type RE2Constructor = RE2Module["RE2"];
type LinearRegex = InstanceType<RE2Constructor>;

/**
 * The packaged RE2 build loads WASM synchronously and is therefore a
 * server-side engine. Browser forms defer regex matching to the authoritative
 * API instead of falling back to JavaScript's backtracking RegExp.
 */
export function canEvaluateLinearRegex(): boolean {
  return typeof window === "undefined" || process.env.NODE_ENV === "test";
}

function loadRE2(): RE2Constructor {
  if (!canEvaluateLinearRegex()) {
    throw new LinearRegexValidationError(new Error("资格规则正则只能在服务端使用 RE2 编译"));
  }
  // Keep the WASM dependency out of the browser bundle. Next's standalone
  // server trace still sees this static CommonJS require and includes it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("re2-wasm") as RE2Module).RE2;
}

/**
 * Error raised when a user-authored pattern is not accepted by RE2.
 *
 * RE2 is the security boundary here: patterns are compiled by the RE2
 * engine, rather than being inspected by a heuristic scanner or executed by
 * JavaScript's backtracking RegExp engine.
 */
export class LinearRegexValidationError extends Error {
  constructor(cause?: unknown) {
    const detail = cause instanceof Error && cause.message ? `：${cause.message}` : "";
    super(`正则表达式无效或包含 RE2 不支持的语法（不支持环视和反向引用）${detail}`);
    this.name = "LinearRegexValidationError";
  }
}

/** Compile with the same RE2 engine used for every qualification match. */
export function compileLinearRegex(pattern: string): LinearRegex {
  try {
    const RE2 = loadRE2();
    return new RE2(pattern, LINEAR_REGEX_FLAGS);
  } catch (error) {
    throw new LinearRegexValidationError(error);
  }
}

/** Match a qualification parameter without invoking JavaScript RegExp. */
export function testLinearRegex(pattern: string, value: string): boolean {
  return compileLinearRegex(pattern).test(value);
}
