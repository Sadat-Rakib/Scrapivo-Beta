"""Relevance demo: deterministic rank + grounded why_relevant (no LLM).

Intent: person, title contains CTO, country Brazil.
Scores: title match 40 + country match 20 + quality/5 (<=20) + social bonus 5.
why_relevant cites ONLY stored fields; empty evidence -> honest fallback.
Usage: python tools/relevance_demo.py
"""
import duckdb

P = "C:/ScrapivoData/processed/people/person.parquet"
c = duckdb.connect()
rows = c.execute(
    "SELECT name, title, company_name, country, industry, website, "
    "personal_linkedin, quality_score FROM read_parquet('%s') "
    "WHERE lower(title) LIKE '%%chief technology officer%%' "
    "AND lower(country) LIKE '%%brazil%%' "
    "ORDER BY quality_score DESC, name LIMIT 5" % P
).fetchall()
print("intent: {entity:person, title:CTO, country:Brazil, signal_required:false}\n")
for name, title, comp, country, ind, site, li, q in rows:
    score = 40 + 20 + min(q / 5, 20) + (5 if li else 0)
    why = (f"{name} ({title}, {comp}) matches: title contains CTO; "
           f"country is {country}; quality {q}/100"
           + (f"; industry {ind}" if ind else "")
           + (f"; site {site}" if site else "") + ".")
    print(f"[{score:.0f}] {why}")
print("\nrelevance demo: deterministic rank + grounded explanations, no LLM")
