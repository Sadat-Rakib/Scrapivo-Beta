from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Scrapivo Scrape Worker")


class FetchRequest(BaseModel):
    url: str


class FetchResponse(BaseModel):
    url: str
    title: str
    markdown: str
    text: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/fetch", response_model=FetchResponse)
async def fetch_url(req: FetchRequest):
    url = req.url.strip()
    title = ""
    markdown = ""
    text = ""

    try:
        from crawl4ai import AsyncWebCrawler

        async with AsyncWebCrawler(verbose=False) as crawler:
            result = await crawler.arun(url=url)
            markdown = (result.markdown or "")[:3000]
            text = markdown
            title = (result.metadata or {}).get("title", "")[:200]
    except Exception:
        import httpx

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
            r = await client.get(url, headers=headers)
            text = r.text[:3000]
            markdown = text

    return FetchResponse(url=url, title=title or url, markdown=markdown, text=text)
