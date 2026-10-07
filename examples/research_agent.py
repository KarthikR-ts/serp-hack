"""Research agent wiring (Search tool + Haystack Agent).

Requires: SERPAPI_API_KEY + an LLM chat generator supporting tools.
This example builds the Agent; it does not hardcode any provider.
"""
import sys

sys.path.insert(0, "src")

from serpapi_haystack.agents import build_plan, classify_query
from serpapi_haystack.toolsets import research_toolset


def main() -> None:
    query = "Research the current state of AI coding agents"
    analysis = classify_query(query)
    print("Intent:", analysis.intent)
    print("Tools:", analysis.tools)
    for step in build_plan(analysis, query):
        print(f" step {step.id}: {step.action} via {step.tool}: {step.query!r}")
    toolset = research_toolset()
    print("Research toolset tools:", [t.name for t in toolset])
    print("Wire into Agent via agents.universal.create_universal_agent(chat_generator).")


if __name__ == "__main__":
    main()
