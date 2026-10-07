"""Phase 4 Example: Media, Academic Papers, Patents, Forums, & Images Discovery.

Demonstrates composing SerpApi News, Scholar, Patents, Forums, and Images components.
"""

import json
from serpapi_haystack.components import (
    SerpApiGoogleNews,
    SerpApiGoogleScholar,
    SerpApiGooglePatents,
    SerpApiGoogleForums,
    SerpApiGoogleImages,
)


def main():
    print("--- Phase 4: Google News ---")
    news_comp = SerpApiGoogleNews()
    news_res = news_comp.run("AI Agents live web research", num_results=2)
    print(f"News Results ({len(news_res['results'])}):")
    for r in news_res['results']:
        print(f" - [{r.get('source')}] {r.get('title')} ({r.get('url')})")

    print("\n--- Phase 4: Google Scholar ---")
    scholar_comp = SerpApiGoogleScholar()
    scholar_res = scholar_comp.run("diffusion model distillation", num_results=2)
    print(f"Scholar Results ({len(scholar_res['results'])}):")
    for r in scholar_res['results']:
        print(f" - {r.get('title')} | Authors: {r.get('authors')}")

    print("\n--- Phase 4: Google Patents ---")
    patents_comp = SerpApiGooglePatents()
    patents_res = patents_comp.run("autonomous vehicle path planning", num_results=2)
    print(f"Patent Results ({len(patents_res['results'])}):")
    for r in patents_res['results']:
        print(f" - Patent {r.get('patent_number')} | {r.get('title')} ({r.get('assignee')})")

    print("\n--- Phase 4: Google Forums ---")
    forums_comp = SerpApiGoogleForums()
    forums_res = forums_comp.run("best laptop for deep learning reddit", num_results=2)
    print(f"Forum Results ({len(forums_res['results'])}):")
    for r in forums_res['results']:
        print(f" - [{r.get('forum_name')}] {r.get('title')} ({r.get('url')})")

    print("\n--- Phase 4: Google Images ---")
    images_comp = SerpApiGoogleImages()
    images_res = images_comp.run("transformers architecture diagram", num_results=2)
    print(f"Image Results ({len(images_res['results'])}):")
    for r in images_res['results']:
        print(f" - {r.get('title')} -> {r.get('image_url')}")


if __name__ == "__main__":
    main()
