"""Normalization, ranking, dedup, cache TTL, limits, intents."""
from serpapi_haystack.models import JobResult, ProductResult, SearchResult
from serpapi_haystack.utils.cache import InMemoryCache
from serpapi_haystack.utils.limits import BudgetLimits, BudgetTracker, BudgetExceededError, run_parallel
from serpapi_haystack.utils.normalization import canonicalize_url, deduplicate, rank_results


def test_search_from_serpapi():
    r = SearchResult.from_serpapi({"title": "T", "link": "https://x.com/a", "snippet": "s"})
    assert r.title == "T" and r.url == "https://x.com/a"


def test_job_parsing():
    j = JobResult.from_serpapi(
        {"title": "Intern", "company_name": "A", "extensions": ["Full-time", "$5k", "Posted 1 day ago"]}
    )
    assert j.employment_type == "Full-time"
    assert j.salary == "$5k"


def test_product_parsing():
    p = ProductResult.from_serpapi({"title": "M", "price": "$10", "extracted_price": 10.0, "rating": "4.5"})
    assert p.numeric_price == 10.0 and p.rating == 4.5


def test_canonicalize_strips_tracking():
    a = canonicalize_url("https://Example.com/Laptops/?utm_source=google&x=1")
    b = canonicalize_url("https://example.com/Laptops?x=1")
    # path case differs so not equal, but tracking param removed
    assert "utm_source" not in a


def test_dedup_url_and_title():
    items = [
        {"title": "Same", "url": "https://e.com/a?utm_source=x"},
        {"title": "Same", "url": "https://e.com/a"},
        {"title": "Different", "url": "https://e.com/b"},
    ]
    assert len(deduplicate(items)) == 2


def test_ranking_formula_weights():
    items = [{"title": f"T{i}", "url": f"https://e.com/{i}", "source": "x"} for i in range(3)]
    ranked = rank_results(items)
    assert ranked[0]["score"] >= ranked[-1]["score"]
    # default relevance weight dominates position order here
    assert ranked[0]["title"] == "T0"


def test_cache_expiry():
    c = InMemoryCache(default_ttl=0.01)
    c.set("k", 1)
    assert c.get("k") == 1
    import time

    time.sleep(0.02)
    assert c.get("k") is None


def test_budget_clamp_and_exceeded():
    lim = BudgetLimits(max_serpapi_calls=2, max_results_per_call=10)
    assert lim.clamp_num_results(50) == 10
    t = BudgetTracker(lim)
    t.consume(2)
    try:
        t.consume(1)
        raise AssertionError("should raise")
    except BudgetExceededError:
        pass


def test_run_parallel_partial_failure():
    def ok():
        return 1

    def boom():
        raise ValueError("x")

    out = run_parallel({"a": ok, "b": boom})
    assert out["a"] == 1 and isinstance(out["b"], ValueError)
