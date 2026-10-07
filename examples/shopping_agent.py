"""Shopping agent wiring (Shopping + Search toolset)."""
import sys

sys.path.insert(0, "src")

from serpapi_haystack.agents import classify_query
from serpapi_haystack.toolsets import shopping_toolset


def main() -> None:
    query = "Find the best OLED monitor under $500"
    print(classify_query(query).to_dict())
    print([t.name for t in shopping_toolset()])


if __name__ == "__main__":
    main()
