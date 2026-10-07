"""Universal agent: intent -> dynamic tools -> plan -> synthesis input.

Run:  python examples/universal_agent.py "Should I buy this laptop for programming?"
"""
import sys

sys.path.insert(0, "src")

from serpapi_haystack.agents import build_plan, classify_query, synthesis_input
from serpapi_haystack.toolsets import toolset_for_analysis


def main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else "Should I buy this laptop for programming?"
    analysis = classify_query(query)
    print("Analysis:", analysis.to_dict())
    toolset = toolset_for_analysis(analysis)
    print("Selected tools:", [t.name for t in toolset])
    for step in build_plan(analysis, query):
        print(f" step {step.id}: {step.action} via {step.tool}")
    # synthesis_input() is called after real tool execution; demo with empty outputs:
    print("Synthesis keys:", sorted(synthesis_input(query, analysis, []).keys()))


if __name__ == "__main__":
    main()
