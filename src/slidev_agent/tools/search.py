"""Web search and content extraction tools using Tavily API."""

import os
from typing import Any

from strands import tool
from tavily import TavilyClient


def _get_tavily_client() -> TavilyClient:
    """Get Tavily client with API key from environment."""
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise ValueError("TAVILY_API_KEY environment variable is not set")
    return TavilyClient(api_key=api_key)


@tool
def web_search(
    query: str,
    max_results: int = 5,
    time_range: str | None = None,
) -> dict[str, Any]:
    """
    Search the web for information on a given topic using Tavily API.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return (1-20). Default is 5.
        time_range: Time range filter (day, week, month, year). Optional.

    Returns:
        A dictionary containing search results with the following structure:
        - query: The search query used
        - results: List of search results, each containing:
            - title: Page title
            - url: Source URL
            - content: Summary snippet
            - score: Relevance score (0-1)
        - response_time: Time taken for the search
    """
    client = _get_tavily_client()

    search_params = {
        "query": query,
        "max_results": min(max(1, max_results), 20),
        "search_depth": "advanced",
        "include_answer": True,
    }

    if time_range and time_range in ["day", "week", "month", "year"]:
        search_params["time_range"] = time_range

    response = client.search(**search_params)

    return {
        "query": response.get("query", query),
        "answer": response.get("answer"),
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "score": r.get("score", 0.0),
            }
            for r in response.get("results", [])
        ],
        "response_time": response.get("response_time", 0),
    }


@tool
def web_extract(url: str) -> dict[str, Any]:
    """
    Extract content from a specific URL using Tavily API.

    Args:
        url: The URL to extract content from.

    Returns:
        A dictionary containing:
        - url: The URL that was extracted
        - content: The extracted content text
        - success: Whether the extraction was successful
    """
    client = _get_tavily_client()

    try:
        response = client.extract(urls=[url])

        if response.get("results"):
            result = response["results"][0]
            return {
                "url": result.get("url", url),
                "content": result.get("raw_content", ""),
                "success": True,
            }
        else:
            return {
                "url": url,
                "content": "",
                "success": False,
                "error": "No content extracted",
            }
    except Exception as e:
        return {
            "url": url,
            "content": "",
            "success": False,
            "error": str(e),
        }
