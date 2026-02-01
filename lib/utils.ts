/**
 * Shared utility functions
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function decodeOutput(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

/**
 * ISO timestamp without milliseconds (2026-01-31T12:00:00Z)
 */
export function isoTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Compute descriptive statistics from a sorted-ascending numeric array.
 * Caller must provide a non-empty array.
 */
export function computeStats(samples: number[]): {
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const n = sorted.length;

  return {
    mean: Math.round(sum / n),
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Detect benchmark mode from results directory name or run metadata
 */
export function detectMode(
  resultsDir: string,
  rawResults: Record<string, unknown>
): "quick" | "full" {
  let mode: "quick" | "full" = resultsDir.includes("quick") ? "quick" : "full";
  const meta = rawResults["run_meta.json"] as { mode?: string } | undefined;
  if (meta?.mode === "quick" || meta?.mode === "full") {
    mode = meta.mode;
  }
  return mode;
}
