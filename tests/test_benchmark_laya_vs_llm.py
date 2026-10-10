"""Benchmark comparing OpenRouter LLM router vs Laya System 1 decision engine.

Runs identical queries through both routing engines and records:
- Chosen engine and presentation
- Latency (ms)
- Accuracy / alignment with intended vertical
"""

from __future__ import annotations

import json
import time
from typing import Any

from serpapi_haystack.agents.laya_router import classify_with_laya, get_laya_router
from serpapi_haystack.agents.llm_router import classify_with_llm

BENCHMARK_CASES = [
    {
        "vertical": "Shopping",
        "expected_engine": "google_shopping",
        "query": "best mechanical keyboard under 100 dollars",
    },
    {
        "vertical": "Travel / Flights",
        "expected_engine": "google_flights",
        "query": "flights from Bangalore to London next Friday",
    },
    {
        "vertical": "Video Learning",
        "expected_engine": "youtube",
        "query": "how does crispr cas9 work beginner video tutorial",
    },
    {
        "vertical": "Finance",
        "expected_engine": "google_finance",
        "query": "NVDA quarterly earnings report stock price",
    },
    {
        "vertical": "Jobs",
        "expected_engine": "google_jobs",
        "query": "python software engineer remote jobs in Europe",
    },
    {
        "vertical": "Academic",
        "expected_engine": "google_scholar",
        "query": "recent research papers on diffusion models arxiv citations",
    },
    {
        "vertical": "Local / Maps",
        "expected_engine": "google_maps",
        "query": "sushi restaurants near central park new york",
    },
    {
        "vertical": "News",
        "expected_engine": "google_news",
        "query": "breaking news about space exploration mission today",
    },
    {
        "vertical": "Events",
        "expected_engine": "google_events",
        "query": "music festivals and concerts in Berlin this summer",
    },
    {
        "vertical": "General Research",
        "expected_engine": "google_search",
        "query": "history of the Roman Empire and the fall of Constantinople",
    },
]


def run_benchmark() -> dict[str, Any]:
    print("Preloading Laya router...")
    get_laya_router(preload=False)

    results = []
    llm_latencies = []
    laya_latencies = []
    llm_correct = 0
    laya_correct = 0

    print(f"\nRunning benchmark across {len(BENCHMARK_CASES)} queries...\n")

    for i, case in enumerate(BENCHMARK_CASES, 1):
        q = case["query"]
        expected = case["expected_engine"]
        vertical = case["vertical"]

        # Run OpenRouter LLM router
        t0 = time.perf_counter()
        try:
            llm_plan = classify_with_llm(q)
            llm_dt = (time.perf_counter() - t0) * 1000.0
            llm_engine = llm_plan.steps[0].engine if llm_plan.steps else "none"
        except Exception as e:
            llm_dt = (time.perf_counter() - t0) * 1000.0
            llm_engine = f"error: {e}"

        # Run Laya router
        t0 = time.perf_counter()
        try:
            laya_plan = classify_with_laya(q)
            laya_dt = (time.perf_counter() - t0) * 1000.0
            laya_engine = laya_plan.steps[0].engine if laya_plan.steps else "none"
            laya_conf = laya_plan.confidence
        except Exception as e:
            laya_dt = (time.perf_counter() - t0) * 1000.0
            laya_engine = f"error: {e}"
            laya_conf = "none"

        llm_latencies.append(llm_dt)
        laya_latencies.append(laya_dt)

        llm_match = (llm_engine == expected)
        laya_match = (laya_engine == expected)
        if llm_match:
            llm_correct += 1
        if laya_match:
            laya_correct += 1

        results.append({
            "vertical": vertical,
            "query": q,
            "expected": expected,
            "llm_engine": llm_engine,
            "llm_ms": round(llm_dt, 1),
            "llm_match": llm_match,
            "laya_engine": laya_engine,
            "laya_ms": round(laya_dt, 1),
            "laya_match": laya_match,
            "laya_conf": laya_conf,
        })

        print(
            f"[{i:02d}] {vertical:16} | Exp: {expected:15} | "
            f"LLM: {llm_engine:15} ({llm_dt:6.1f}ms) [{'OK' if llm_match else 'FAIL'}] | "
            f"Laya: {laya_engine:15} ({laya_dt:6.1f}ms) [{'OK' if laya_match else 'FAIL'}]"
        )

    avg_llm_ms = sum(llm_latencies) / len(llm_latencies)
    avg_laya_ms = sum(laya_latencies) / len(laya_latencies)

    summary = {
        "total_queries": len(BENCHMARK_CASES),
        "llm_accuracy": f"{llm_correct}/{len(BENCHMARK_CASES)} ({llm_correct / len(BENCHMARK_CASES) * 100:.1f}%)",
        "laya_accuracy": f"{laya_correct}/{len(BENCHMARK_CASES)} ({laya_correct / len(BENCHMARK_CASES) * 100:.1f}%)",
        "avg_llm_latency_ms": round(avg_llm_ms, 1),
        "avg_laya_latency_ms": round(avg_laya_ms, 1),
        "details": results,
    }

    print("\n" + "=" * 70)
    print("BENCHMARK SUMMARY")
    print("=" * 70)
    print(f"Accuracy:  LLM = {summary['llm_accuracy']}  |  Laya = {summary['laya_accuracy']}")
    print(f"Latency:   LLM = {avg_llm_ms:.1f} ms  |  Laya = {avg_laya_ms:.1f} ms (CPU)")
    print("=" * 70)

    return summary


if __name__ == "__main__":
    run_benchmark()
