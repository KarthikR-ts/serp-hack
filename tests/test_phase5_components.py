"""Unit tests for Phase 5 components and tools (Mocked, no live SerpApi key required)."""

import pytest
from unittest.mock import MagicMock
from serpapi_haystack.components import (
    SerpApiGoogleMaps,
    SerpApiGoogleFlights,
    SerpApiGoogleHotels,
    SerpApiGoogleFinance,
    SerpApiGoogleTrends,
    SerpApiGoogleEvents,
)
from serpapi_haystack.tools import (
    create_maps_tool,
    create_flights_tool,
    create_hotels_tool,
    create_finance_tool,
    create_trends_tool,
    create_events_tool,
)


def test_google_maps_component(monkeypatch):
    comp = SerpApiGoogleMaps(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "local_results": [
            {
                "title": "Blue Bottle Coffee",
                "address": "66 Mint St, San Francisco, CA",
                "rating": 4.6,
                "reviews": 1200,
                "phone": "+1 415-555-0100",
                "type": "Coffee shop",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("coffee sf", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["title"] == "Blue Bottle Coffee"
    assert out["results"][0]["rating"] == 4.6


def test_google_flights_component(monkeypatch):
    comp = SerpApiGoogleFlights(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "best_flights": [
            {
                "airline": "Delta",
                "price": "$350",
                "total_duration": "5h 30m",
                "flights": [
                    {
                        "airline": "Delta",
                        "flight_number": "DL 123",
                        "departure_airport": {"name": "JFK"},
                        "arrival_airport": {"name": "LAX"},
                    }
                ],
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run(departure_id="JFK", arrival_id="LAX", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["airline"] == "Delta"
    assert out["results"][0]["price"] == "$350"


def test_google_hotels_component(monkeypatch):
    comp = SerpApiGoogleHotels(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "properties": [
            {
                "name": "Park Hyatt Tokyo",
                "rate_per_night": {"lowest": "$450"},
                "overall_rating": 4.8,
                "reviews": 850,
                "location": "Shinjuku, Tokyo",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("Tokyo hotels", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["name"] == "Park Hyatt Tokyo"
    assert out["results"][0]["price"] == "$450"


def test_google_finance_component(monkeypatch):
    comp = SerpApiGoogleFinance(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "summary": {
            "title": "Alphabet Inc",
            "symbol": "GOOGL",
            "price": "$175.50",
            "price_change": "+2.30",
            "price_change_percent": "+1.33%",
        },
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("GOOGL stock", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["symbol"] == "GOOGL"


def test_google_trends_component(monkeypatch):
    comp = SerpApiGoogleTrends(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "query": "Artificial Intelligence",
        "related_queries": {
            "rising": [{"query": "Generative AI"}, {"query": "Claude 3"}]
        },
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("Artificial Intelligence")
    assert len(out["results"]) == 1
    assert out["results"][0]["query"] == "Artificial Intelligence"
    assert "Generative AI" in out["results"][0]["rising_queries"]


def test_google_events_component(monkeypatch):
    comp = SerpApiGoogleEvents(api_key="test_key")
    mock_client = MagicMock()
    mock_client.search.return_value = {
        "search_metadata": {"id": "123"},
        "events_results": [
            {
                "title": "AI World Summit",
                "date": {"when": "Oct 15, 2026"},
                "venue": {"name": "Javits Center"},
                "description": "Annual AI conference in NYC.",
            }
        ],
    }
    monkeypatch.setattr(comp, "_get_client", lambda: mock_client)

    out = comp.run("AI event NYC", num_results=5)
    assert len(out["results"]) == 1
    assert out["results"][0]["title"] == "AI World Summit"


def test_phase5_tools_creation():
    assert create_maps_tool(api_key="test_key").name == "google_maps"
    assert create_flights_tool(api_key="test_key").name == "google_flights"
    assert create_hotels_tool(api_key="test_key").name == "google_hotels"
    assert create_finance_tool(api_key="test_key").name == "google_finance"
    assert create_trends_tool(api_key="test_key").name == "google_trends"
    assert create_events_tool(api_key="test_key").name == "google_events"
