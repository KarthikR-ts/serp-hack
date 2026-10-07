"""Basic search: SerpApiClient + Google Search component (no agent).

Run:  SERPAPI_API_KEY=... python examples/basic_search.py "best laptops under 800"
"""
import os
import sys

sys.path.insert(0, "src")

from serpapi_haystack.client import SerpApiClient
from serpapi_haystack.components import SerpApiGoogleSearch


def main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else "best laptops for machine learning under $1000"
    api_key = os.getenv("SERPAPI_API_KEY", "")
    if not api_key:
        print("Set SERPAPI_API_KEY to run live. Showing dry-run structure.")
        comp = SerpApiGoogleSearch(api_key="demo")
        print(comp.to_dict()["type"])
        return
    client = SerpApiClient(api_key=api_key)
    print("Raw search keys:", sorted(client.search("google", query, num=3).keys()))
    comp = SerpApiGoogleSearch(api_key=api_key)
    out = comp.run(query, num_results=5)
    for r in out["results"]:
        print(f"- {r['title']} ({r['url']}) score={r['score']}")


if __name__ == "__main__":
    main()
