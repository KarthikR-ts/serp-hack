"""serpapi_haystack — SerpApi x Haystack universal web intelligence (Phases 0-3)."""
from .agents import build_plan, classify_query
from .client import SerpApiClient
from .components import SerpApiGoogleJobs, SerpApiGoogleSearch, SerpApiGoogleShopping

__all__ = [
    "SerpApiClient",
    "SerpApiGoogleSearch",
    "SerpApiGoogleJobs",
    "SerpApiGoogleShopping",
    "classify_query",
    "build_plan",
]

__version__ = "0.1.0"
