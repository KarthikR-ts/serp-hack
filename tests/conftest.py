"""Shared fixtures: mocked SerpApi payloads (no live key needed)."""
import pytest

SEARCH_JSON = {
    "search_metadata": {"id": "abc", "status": "Success"},
    "search_information": {"total_results": 2},
    "organic_results": [
        {
            "position": 1,
            "title": "Best laptops for ML 2026",
            "link": "https://example.com/laptops?utm_source=google",
            "snippet": "Top picks under budget...",
            "source": "Example",
            "date": "2026-09-01",
        },
        {
            "position": 2,
            "title": "Best laptops for ML 2026",  # near-duplicate title
            "link": "https://example.com/laptops",
            "snippet": "Top picks under budget...",
            "source": "Example",
        },
    ],
}

JOBS_JSON = {
    "search_metadata": {"id": "jobs1"},
    "jobs_results": [
        {
            "title": "Software Engineering Intern",
            "company_name": "Company A",
            "location": "Bengaluru, India",
            "via": "Google",
            "extensions": ["Full-time", "Posted 2 days ago"],
            "detected_extensions": {"salary": "₹80,000/month"},
            "share_link": "https://example.com/job-a",
        },
        {
            "title": "Engineering Intern",
            "company_name": "Company B",
            "location": "Remote",
            "via": "LinkedIn",
            "extensions": ["Internship"],
            "share_link": "https://example.com/job-b",
        },
    ],
}

SHOPPING_JSON = {
    "search_metadata": {"id": "shop1"},
    "shopping_results": [
        {
            "position": 1,
            "title": "OLED Monitor 27in",
            "link": "https://shop.example.com/monitor",
            "price": "$449.00",
            "extracted_price": 449.0,
            "source": "ExampleStore",
            "rating": 4.5,
            "reviews": 120,
            "thumbnail": "https://img.example.com/m.jpg",
        }
    ],
}


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.headers = {}
        self.text = str(payload)[:300]

    def json(self):
        return self._payload


@pytest.fixture
def api_key():
    return "test-key"
