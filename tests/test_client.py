"""Phase 1 tests: SerpApiClient (auth, HTTP, retries, errors, cache, logging)."""
import requests

import pytest
from serpapi_haystack.client import (
    SerpApiAuthError,
    SerpApiBadRequestError,
    SerpApiClient,
    SerpApiRateLimitError,
    SerpApiServerError,
)
from serpapi_haystack.client.client import _redact
from serpapi_haystack.utils.cache import InMemoryCache
from tests.conftest import SEARCH_JSON, FakeResponse


def _client(monkeypatch, payload=SEARCH_JSON, status=200, **kwargs):
    c = SerpApiClient(api_key="k", max_retries=kwargs.pop("max_retries", 1), **kwargs)
    monkeypatch.setattr(c.session, "get", lambda *a, **k: FakeResponse(payload, status))
    return c


def test_missing_key_raises():
    with pytest.raises(SerpApiAuthError):
        SerpApiClient(api_key="")


def test_empty_query_rejected(monkeypatch):
    c = _client(monkeypatch)
    with pytest.raises(SerpApiBadRequestError):
        c.search("google", "   ")


def test_valid_request(monkeypatch):
    c = _client(monkeypatch)
    out = c.search("google", "laptops")
    assert out["search_metadata"]["id"] == "abc"


def test_auth_error(monkeypatch):
    c = _client(monkeypatch, status=401)
    with pytest.raises(SerpApiAuthError):
        c.search("google", "x")


def test_rate_limit_retries_then_raises(monkeypatch):
    c = SerpApiClient(api_key="k", max_retries=2, backoff_factor=0.0)
    calls = {"n": 0}

    def fake_get(*a, **k):
        calls["n"] += 1
        return FakeResponse({}, 429)

    monkeypatch.setattr(c.session, "get", fake_get)
    monkeypatch.setattr("time.sleep", lambda s: None)
    with pytest.raises(SerpApiRateLimitError):
        c.search("google", "x")
    assert calls["n"] == 3  # 1 + 2 retries


def test_server_error_retries(monkeypatch):
    c = SerpApiClient(api_key="k", max_retries=1, backoff_factor=0.0)
    monkeypatch.setattr(c.session, "get", lambda *a, **k: FakeResponse({}, 500))
    monkeypatch.setattr("time.sleep", lambda s: None)
    with pytest.raises(SerpApiServerError):
        c.search("google", "x")


def test_timeout_maps_to_timeout_error(monkeypatch):
    c = SerpApiClient(api_key="k", max_retries=0)

    def boom(*a, **k):
        raise requests.Timeout("slow")

    monkeypatch.setattr(c.session, "get", boom)
    from serpapi_haystack.client import SerpApiTimeoutError

    with pytest.raises(SerpApiTimeoutError):
        c.search("google", "x")


def test_api_error_field_classified(monkeypatch):
    c = _client(monkeypatch, payload={"error": "Invalid API key"}, status=200)
    with pytest.raises(SerpApiAuthError):
        c.search("google", "x")


def test_cache_hook(monkeypatch):
    cache = InMemoryCache(default_ttl=60)
    c = SerpApiClient(api_key="k", cache=cache)
    calls = {"n": 0}

    def fake_get(*a, **k):
        calls["n"] += 1
        return FakeResponse(SEARCH_JSON, 200)

    monkeypatch.setattr(c.session, "get", fake_get)
    c.search("google", "laptops")
    c.search("google", "laptops")  # cache hit
    assert calls["n"] == 1


def test_redaction():
    assert _redact({"api_key": "secret", "q": "x"})["api_key"] == "***REDACTED***"
