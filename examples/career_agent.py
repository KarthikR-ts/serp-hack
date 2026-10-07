"""Career agent wiring (Jobs + Search toolset)."""
import sys

sys.path.insert(0, "src")

from serpapi_haystack.agents import classify_query
from serpapi_haystack.toolsets import careers_toolset


def main() -> None:
    query = "Find software engineering internships in Bengaluru"
    print(classify_query(query).to_dict())
    print([t.name for t in careers_toolset()])


if __name__ == "__main__":
    main()
