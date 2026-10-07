"""Phase 5 Example: Maps, Flights, Hotels, Finance, Trends, & Events.

Demonstrates composing SerpApi Maps, Flights, Hotels, Finance, Trends, and Events components.
"""

from serpapi_haystack.components import (
    SerpApiGoogleMaps,
    SerpApiGoogleFlights,
    SerpApiGoogleHotels,
    SerpApiGoogleFinance,
    SerpApiGoogleTrends,
    SerpApiGoogleEvents,
)


def main():
    print("--- Phase 5: Google Maps / Local ---")
    maps_comp = SerpApiGoogleMaps()
    maps_res = maps_comp.run("coffee shops near downtown San Francisco", num_results=2)
    print(f"Maps Results ({len(maps_res['results'])}):")
    for r in maps_res['results']:
        print(f" - {r.get('title')} | Rating: {r.get('rating')} | Address: {r.get('address')}")

    print("\n--- Phase 5: Google Flights ---")
    flights_comp = SerpApiGoogleFlights()
    flights_res = flights_comp.run(departure_id="JFK", arrival_id="LAX", num_results=2)
    print(f"Flight Results ({len(flights_res['results'])}):")
    for r in flights_res['results']:
        print(f" - {r.get('airline')} {r.get('flight_number')} | {r.get('departure')} -> {r.get('arrival')} | Price: {r.get('price')}")

    print("\n--- Phase 5: Google Hotels ---")
    hotels_comp = SerpApiGoogleHotels()
    hotels_res = hotels_comp.run("hotels in Tokyo", num_results=2)
    print(f"Hotel Results ({len(hotels_res['results'])}):")
    for r in hotels_res['results']:
        print(f" - {r.get('name')} | Price: {r.get('price')} | Rating: {r.get('rating')}")

    print("\n--- Phase 5: Google Finance ---")
    finance_comp = SerpApiGoogleFinance()
    finance_res = finance_comp.run("GOOGL stock", num_results=2)
    print(f"Finance Results ({len(finance_res['results'])}):")
    for r in finance_res['results']:
        print(f" - {r.get('stock_name')} ({r.get('symbol')}) | Price: {r.get('price')} {r.get('currency')}")

    print("\n--- Phase 5: Google Trends ---")
    trends_comp = SerpApiGoogleTrends()
    trends_res = trends_comp.run("Generative AI")
    print(f"Trends Results ({len(trends_res['results'])}):")
    for r in trends_res['results']:
        print(f" - Top rising queries for '{r.get('query')}': {r.get('rising_queries')[:3]}")

    print("\n--- Phase 5: Google Events ---")
    events_comp = SerpApiGoogleEvents()
    events_res = events_comp.run("AI conference New York", num_results=2)
    print(f"Events Results ({len(events_res['results'])}):")
    for r in events_res['results']:
        print(f" - {r.get('title')} | Date: {r.get('date')} | Venue: {r.get('venue')}")


if __name__ == "__main__":
    main()
