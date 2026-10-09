"""Phase 6 Example: Universal Web Intelligence Agent Server & CLI interface.

Demonstrates running the FastAPI server and querying universal intent router.
"""

import sys
import json
from serpapi_haystack.agents.intents import classify_query
from serpapi_haystack.agents.universal import build_plan
from serpapi_haystack.toolsets import toolset_for_analysis


def run_cli_query(query: str):
    print(f"\n=======================================================")
    print(f"USER QUERY: '{query}'")
    print(f"=======================================================")

    analysis = classify_query(query)
    print("\n1. INTENT ANALYSIS:")
    print(f" - Matched Intents : {analysis.intent}")
    print(f" - Extracted Entities: {analysis.entities}")
    print(f" - Constraints      : {analysis.constraints}")
    print(f" - Freshness req.   : {analysis.freshness}")

    plan = build_plan(analysis, query)
    print("\n2. RESEARCH PLAN:")
    for step in plan:
        print(f" - Step {step.id}: [{step.action.upper()}] using tool '{step.tool}'")

    toolset = toolset_for_analysis(analysis)
    print("\n3. SELECTED DYNAMIC TOOLS:")
    for t in toolset.tools:
        print(f" - {t.name}: {t.description[:80]}...")


def main():
    queries = [
        "Teach me CRISPR gene editing using recent papers, lab protocols, and community opinions",
        "Find me 3 OLED monitors under $500 with user reviews from reddit",
        "Plan a weekend trip to Tokyo including flights from JFK, hotels under $200, and local events",
        "Research Apple Inc stock trends, recent press releases, and patent filings",
    ]
    for q in queries:
        run_cli_query(q)


if __name__ == "__main__":
    main()
