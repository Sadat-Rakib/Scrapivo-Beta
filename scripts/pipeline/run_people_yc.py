"""People harvest from YC companies' own websites — published info only.

For each YC company (bounded per run, polite delay): fetch the homepage plus
/team /about /about-us /founders, then extract what the company itself
publishes about its people:
  - person names + roles from team headings/cards (heuristic, evidence-backed)
  - linkedin.com/company/… links → stored on the COMPANY side (evidence)
  - linkedin.com/in/… links that the company's own pages link to → PersonRecord

NO authenticated LinkedIn access, no profile scraping behind login — only
public pages the company publishes. Emails are NOT extracted here (that is
Scrapivo's verified waterfall's job at outreach time).

Usage:
  python -m scripts.pipeline.run_people_yc --limit 100 [--offset 0] [--delay 1.0]
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .confidence import score_confidence
from .models import PersonRecord
from .normalize import normalize_domain
from .store import DuckStore

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
UA = "Scrapivo Data Pipeline (public team-page harvest; contact: mirsadat@scrapivo.com)"

TEAM_PATHS = ["", "/team", "/about", "/about-us", "/founders", "/people"]

LINKEDIN_IN_RE = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9_%-]{3,})/?", re.I)
LINKEDIN_COMPANY_RE = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/([A-Za-z0-9_%.-]{2,})/?", re.I)
# Person-name-ish anchor text: 2-4 capitalized words (keeps "Sara Johnson",
# drops "Learn more", "About us", "Contact").
NAME_RE = re.compile(r"^[A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){1,3}$")
ROLE_WORDS = re.compile(
    r"\b(co-?founder|founder|ceo|cto|cfo|coo|cmo|cro|chief [a-z]+ officer|"
    r"managing director|president|vp [a-z]+|vice president [a-z]+|"
    r"director of [a-z ]+|head of [a-z ]+|partner|general manager)\b",
    re.I,
)


def load_yc_companies() -> list[dict]:
    """From the DuckDB companies table (source='yc') — keeps one source of truth."""
    store = DuckStore()
    rows = store.con.execute(
        "SELECT payload FROM companies WHERE json_extract_string(payload, '$.source') = 'yc' "
        "ORDER BY json_extract_string(payload, '$.name')"
    ).fetchall()
    return [json.loads(r[0]) for r in rows]


def fetch_text(client: httpx.Client, url: str) -> str | None:
    try:
        res = client.get(url, follow_redirects=True, timeout=15)
        if res.status_code != 200 or "text/html" not in res.headers.get("content-type", ""):
            return None
        return res.text
    except Exception:
        return None


def extract_people(html: str, base_domain: str) -> list[tuple[str, str | None, str | None]]:
    """(name, role, linkedin_in_url) triples from anchors/headings near role words.

    Never invents a name: a LinkedIn slug with no separators ("emmanouelapetsolari")
    cannot be safely split into words, so those people are skipped rather than
    stored as mangled names."""
    people: dict[str, tuple[str, str | None, str | None]] = {}
    for m in LINKEDIN_IN_RE.finditer(html):
        slug = m.group(1)
        if slug.lower() in {"pub", "dir", "feed", "home"}:
            continue
        window = html[max(0, m.start() - 400): m.end() + 400]
        text = re.sub(r"<[^>]+>", " ", window)
        text = re.sub(r"\s+", " ", text)
        names = NAME_RE.findall(text)
        if names:
            name = names[0].strip()
        elif re.search(r"[-_%20]", slug) or re.search(r"[a-z][A-Z]", slug):
            name = re.sub(r"[-_]|%20", " ", slug).strip()
            name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name).title()
        else:
            continue  # separator-less slug — a guessed name would be garbage
        role_m = ROLE_WORDS.search(text)
        key = slug.lower()
        prev = people.get(key)
        if prev is None or (prev[1] is None and role_m):
            people[key] = (name, role_m.group(0).title() if role_m else None, m.group(0).rstrip("/"))
    # Founder/role lines without LinkedIn (name from text near role words).
    if not people:
        text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html)
        text = re.sub(r"<[^>]+>", "\n", text)
        for line in text.split("\n"):
            line = line.strip()
            if not line or not NAME_RE.match(line):
                continue
            role_m = ROLE_WORDS.search(line)
            if role_m and 4 <= len(line) <= 80:
                clean_name = ROLE_WORDS.sub("", line).strip(" ·,|-—")
                if NAME_RE.match(clean_name):
                    people[clean_name.lower()] = (clean_name, role_m.group(0).title(), None)
    return list(people.values())[:8]


def harvest(client: httpx.Client, company: dict, delay: float) -> tuple[list[PersonRecord], str | None]:
    website = (company.get("website") or "").strip()
    if not website:
        return [], None
    domain = normalize_domain(website)
    if not domain:
        return [], None
    base = f"https://{domain}"
    company_li: str | None = None
    people: dict[str, PersonRecord] = {}

    for path in TEAM_PATHS:
        if company_li and people:
            break
        html = fetch_text(client, base + path)
        if not html:
            continue
        if company_li is None:
            m = LINKEDIN_COMPANY_RE.search(html)
            if m:
                company_li = m.group(0).rstrip("/")
        for name, role, li_url in extract_people(html, domain):
            key = name.lower()
            prev = people.get(key)
            if prev and prev.linkedin and not li_url:
                continue
            conf = score_confidence("directory", has_email=False, address_complete=False)
            people[key] = PersonRecord(
                source="yc_site_harvest",
                registry_id=f"{company.get('registry_id') or company.get('slug') or domain}:{key}",
                name=name,
                role=role,
                company=company.get("name"),
                company_domain=domain,
                linkedin=li_url,
                bio=None,
                confidence=conf,
                source_tier="directory",
                evidence=[f"published_at:{domain}{path or '/'}"],
            )
        time.sleep(delay)
    return list(people.values()), company_li


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100, help="companies per run (polite pace)")
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--delay", type=float, default=1.0)
    args = ap.parse_args()

    companies = load_yc_companies()
    batch = companies[args.offset: args.offset + args.limit]
    print(f"[people] harvesting {len(batch)} YC company sites (offset {args.offset}) …")

    company_links: dict[str, str] = {}
    all_people: list[PersonRecord] = []
    with httpx.Client(headers={"User-Agent": UA}) as client:
        for i, company in enumerate(batch, 1):
            people, li = harvest(client, company, args.delay)
            if li:
                company_links[company.get("slug", "?")] = li
            all_people.extend(people)
            if i % 10 == 0:
                print(f"[people] {i}/{len(batch)} — {len(all_people)} people so far")

    # Company LinkedIn links → update the company payload's linkedin field.
    store = DuckStore()
    store.ensure_table("people", all_people[0] if all_people else None)
    stats = store.upsert("people", all_people)
    print(
        f"[people] upsert: seen={stats.seen} inserted={stats.inserted} "
        f"updated={stats.updated} touched={stats.touched}"
    )
    li_out = DATA_DIR / "yc_company_linkedin.json"
    prev: dict[str, str] = {}
    if li_out.exists():
        try:
            prev = json.loads(li_out.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
    prev.update(company_links)
    li_out.write_text(json.dumps(prev, ensure_ascii=False, indent=1), encoding="utf-8")

    out = DATA_DIR / "people_complete.jsonl"
    n = store.export_jsonl("people", out)
    print(f"[people] exported {n} people → {out} ({out.stat().st_size / 1024:.0f} KiB); "
          f"{len(prev)} company LinkedIn links")


if __name__ == "__main__":
    main()
