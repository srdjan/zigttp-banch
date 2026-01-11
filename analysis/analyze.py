#!/usr/bin/env python3
"""
Statistical analysis for zigttp benchmark suite.
Produces: percentiles, confidence intervals, Mann-Whitney U test, markdown report.
"""

import argparse
import json
from pathlib import Path
from datetime import datetime
from typing import Any

try:
    import numpy as np
    from scipy import stats
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    print("Warning: scipy not installed, statistical tests disabled")


def load_results(results_dir: Path) -> dict[str, Any]:
    """Load all JSON result files from directory."""
    results = {}
    for f in results_dir.glob("*.json"):
        if f.name == "versions.json":
            results["versions"] = json.loads(f.read_text())
        elif f.name == "system_info.json":
            results["system"] = json.loads(f.read_text())
        elif f.name.startswith("http_"):
            if "http" not in results:
                results["http"] = {}
            data = json.loads(f.read_text())
            key = f"{data.get('runtime', 'unknown')}_{data.get('endpoint', '').replace('/', '_')}"
            results["http"][key] = data
        elif f.name.startswith("microbench_"):
            if "microbench" not in results:
                results["microbench"] = {}
            data = json.loads(f.read_text())
            results["microbench"][data.get("runtime", "unknown")] = data
        elif f.name.startswith("coldstart_"):
            if "coldstart" not in results:
                results["coldstart"] = {}
            data = json.loads(f.read_text())
            results["coldstart"][data.get("runtime", "unknown")] = data
        elif f.name.startswith("memory_"):
            if "memory" not in results:
                results["memory"] = {}
            data = json.loads(f.read_text())
            results["memory"][data.get("runtime", "unknown")] = data
    return results


def compute_percentiles(data: list[float]) -> dict[str, float]:
    """Compute standard percentiles."""
    if not data:
        return {}
    arr = np.array(data) if HAS_SCIPY else data
    if HAS_SCIPY:
        return {
            "mean": float(np.mean(arr)),
            "median": float(np.median(arr)),
            "std": float(np.std(arr)),
            "p50": float(np.percentile(arr, 50)),
            "p95": float(np.percentile(arr, 95)),
            "p99": float(np.percentile(arr, 99)),
            "min": float(np.min(arr)),
            "max": float(np.max(arr)),
            "n": len(arr)
        }
    else:
        sorted_data = sorted(data)
        n = len(sorted_data)
        return {
            "mean": sum(data) / n,
            "median": sorted_data[n // 2],
            "min": sorted_data[0],
            "max": sorted_data[-1],
            "n": n
        }


def mann_whitney_test(a: list[float], b: list[float]) -> dict[str, Any]:
    """Perform Mann-Whitney U test for comparing distributions."""
    if not HAS_SCIPY or len(a) < 3 or len(b) < 3:
        return {"available": False}
    stat, p_value = stats.mannwhitneyu(a, b, alternative='two-sided')
    return {
        "available": True,
        "statistic": float(stat),
        "p_value": float(p_value),
        "significant_at_005": p_value < 0.05
    }


def generate_report(results: dict[str, Any], output_path: Path) -> None:
    """Generate markdown report from results."""
    lines = []
    lines.append("# zigttp Benchmark Results")
    lines.append("")
    lines.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")

    # System info
    if "system" in results:
        sys = results["system"]
        lines.append("## System Information")
        lines.append("")
        lines.append(f"- **OS:** {sys.get('os', 'unknown')} {sys.get('os_version', '')}")
        lines.append(f"- **CPU:** {sys.get('cpu_model', 'unknown')}")
        lines.append(f"- **Cores:** {sys.get('cpu_cores', 'unknown')}")
        lines.append(f"- **RAM:** {sys.get('ram_gb', 'unknown')} GB")
        lines.append("")

        runtimes = sys.get("runtimes", {})
        if runtimes:
            lines.append("### Runtime Versions")
            lines.append("")
            for rt, ver in runtimes.items():
                lines.append(f"- **{rt}:** {ver}")
            lines.append("")

    # HTTP Results
    if "http" in results:
        lines.append("## HTTP Benchmark Results")
        lines.append("")
        lines.append("| Runtime | Endpoint | RPS | p99 Latency |")
        lines.append("|---------|----------|-----|-------------|")

        for key, data in sorted(results["http"].items()):
            runtime = data.get("runtime", "unknown")
            endpoint = data.get("endpoint", "unknown")
            metrics = data.get("metrics", {})
            rps = metrics.get("requests_per_second", 0)
            p99 = metrics.get("latency_p99_secs", 0)
            lines.append(f"| {runtime} | {endpoint} | {rps:,.0f} | {p99:.4f}s |")
        lines.append("")

    # Microbenchmark Results
    if "microbench" in results:
        lines.append("## Microbenchmark Results")
        lines.append("")

        # Get all benchmark names
        bench_names = set()
        for runtime_data in results["microbench"].values():
            benchmarks = runtime_data.get("benchmarks", {})
            bench_names.update(benchmarks.keys())

        if bench_names:
            runtimes = list(results["microbench"].keys())
            header = "| Benchmark |" + "|".join(f" {rt} |" for rt in runtimes)
            lines.append(header)
            lines.append("|" + "|".join(["---"] * (len(runtimes) + 1)) + "|")

            for bench in sorted(bench_names):
                row = f"| {bench} |"
                for rt in runtimes:
                    benchmarks = results["microbench"][rt].get("benchmarks", {})
                    if bench in benchmarks:
                        ops = benchmarks[bench].get("ops_per_sec", 0)
                        row += f" {ops:,.2f} ops/s |"
                    else:
                        row += " - |"
                lines.append(row)
            lines.append("")

    # Cold Start Results
    if "coldstart" in results:
        lines.append("## Cold Start Results")
        lines.append("")
        lines.append("| Runtime | Mean | Median | p95 | p99 |")
        lines.append("|---------|------|--------|-----|-----|")

        for runtime, data in sorted(results["coldstart"].items()):
            metrics = data.get("metrics", {})
            mean_us = metrics.get("mean_us", 0)
            median_us = metrics.get("median_us", 0)
            p95_us = metrics.get("p95_us", 0)
            p99_us = metrics.get("p99_us", 0)
            lines.append(f"| {runtime} | {mean_us:,}us | {median_us:,}us | {p95_us:,}us | {p99_us:,}us |")
        lines.append("")

    # Memory Results
    if "memory" in results:
        lines.append("## Memory Usage")
        lines.append("")
        lines.append("| Runtime | Baseline | Peak | Avg |")
        lines.append("|---------|----------|------|-----|")

        for runtime, data in sorted(results["memory"].items()):
            metrics = data.get("metrics", {})
            baseline = metrics.get("baseline_kb", 0)
            peak = metrics.get("peak_kb", 0)
            avg = metrics.get("avg_kb", 0)
            lines.append(f"| {runtime} | {baseline:,} KB | {peak:,} KB | {avg:,} KB |")
        lines.append("")

    # Methodology link
    lines.append("## Methodology")
    lines.append("")
    lines.append("See [methodology.md](../methodology.md) for detailed test methodology.")
    lines.append("")

    # Write report
    output_path.write_text("\n".join(lines))
    print(f"Report written to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Analyze zigttp benchmark results")
    parser.add_argument("--results-dir", required=True, help="Directory containing result JSON files")
    parser.add_argument("--output", required=True, help="Output markdown file path")
    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    output_path = Path(args.output)

    if not results_dir.exists():
        print(f"Results directory not found: {results_dir}")
        return 1

    results = load_results(results_dir)
    if not results:
        print("No results found")
        return 1

    generate_report(results, output_path)
    return 0


if __name__ == "__main__":
    exit(main())
