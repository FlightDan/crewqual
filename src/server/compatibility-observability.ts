/** Fixed labels only: never pass request URLs, cookies, tokens, or user content. */
export type CompatibilityPath = "legacy_cookie" | "legacy_api" | "legacy_record_fallback";

export function observeCompatibilityPath(path: CompatibilityPath): void {
  // One event is one use. Aggregate across every web/worker instance in the log
  // collector; in-process counters cannot prove a zero-use observation period.
  console.info(JSON.stringify({ event: "compatibility_path_used", path, count: 1 }));
}
