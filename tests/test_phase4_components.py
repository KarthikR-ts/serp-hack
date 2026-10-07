"""Unit tests for Phase 4 components and tools (Mocked, no live SerpApi key required)."""

import pytest
from unittest.mock import MagicMock
from serpapi_haystack.components import (
    SerpApiGoogleNews,
    SerpApiGoogleScholar,
    SerpApiGooglePatents,
    SerpApiGoogleForums,
    SerpApiGoogleImages,
)
from serpapi_haystack.tools import (
    create_news_tool,
    create_scholar_tool,
    create_patents_tool,
    create_forums_tool,
    create_images_tool,
)


def test_google_news_component(monkeypatch):
    comp = SerpApiGoogleNews(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "news_results": [
            {
                "title": "AI Breakthrough Announced",
                "link": "https://news.example.com/ai",
                "snippet": "New model beats benchmarks.",
                "source": "TechDaily",
                "date": "2 hours ago",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("AI news", num_results=5)
    assert "results" in out
    assert len(out["results"]) == 1
    assert out["results"][0]["title"] == "AI Breakthrough Announced"
    assert out["evidence"][0]["tool_used"] == "google_news"


def test_google_scholar_component(monkeypatch):
    comp = SerpApiGoogleScholar(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "organic_results": [
            {
                "title": "Attention Is All You Need",
                "link": "https://arxiv.org/abs/1706.03762",
                "snippet": "We propose the Transformer architecture...",
                "publication_info": {"summary": "Vaswani et al. - NeurIPS 2017"},
                "inline_links": {"cited_by": {"total": 100000}},
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("Transformers", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["title"] == "Attention Is All You Need"
    assert out["results"][0]["citations"] == 100000


def test_google_patents_component(monkeypatch):
    comp = SerpApiGooglePatents(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "organic_results": [
            {
                "title": "System and method for neural network training",
                "patent_id": "US12345678B2",
                "assignee": "Google LLC",
                "snippet": "A method for parallel model training...",
                "pdf": "https://patents.google.com/patent/US12345678B2.pdf",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("neural network training", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["patent_number"] == "US12345678B2"


def test_google_forums_component(monkeypatch):
    comp = SerpApiGoogleForums(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "organic_results": [
            {
                "title": "Which laptop is best for machine learning?",
                "link": "https://reddit.com/r/MachineLearning/123",
                "snippet": "I recommend getting at least 32GB RAM...",
                "source": "Reddit",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("laptop machine learning reddit", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["title"] == "Which laptop is best for machine learning?"


def test_google_images_component(monkeypatch):
    comp = SerpApiGoogleImages(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "images_results": [
            {
                "title": "Transformer Architecture Diagram",
                "original": "https://images.example.com/transformer.png",
                "link": "https://example.com/transformer",
                "source": "Example",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("transformer architecture", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["image_url"] == "https://images.example.com/transformer.png"


def test_phase4_tools_creation():
    news_tool = create_news_tool(api_key="test_key")
    assert news_tool.name == "google_news"

    scholar_tool = create_scholar_tool(api_key="test_key")
    assert scholar_tool.name == "google_scholar"

    patents_tool = create_patents_tool(api_key="test_key")
    assert patents_tool.name == "google_patents"

    forums_tool = create_forums_tool(api_key="test_key")
    assert forums_tool.name == "google_forums"

    images_tool = create_images_tool(api_key="test_key")
    assert images_tool.name == "google_images"
