import json
from pathlib import Path
from collections import Counter

lines = Path("tmp/live-adversarial-soak.jsonl").read_text(encoding="utf-8").strip().splitlines()
cases = []
cancel = None
env = None
for ln in lines:
    o = json.loads(ln)
    k = o.get("kind")
    if k == "env":
        env = o
    elif k == "case":
        cases.append(o)
    elif k == "cancel":
        cancel = o

print("cases", len(cases))
print("buckets", dict(Counter(c["failure_bucket"] for c in cases)))
print("success", sum(1 for c in cases if c.get("success_criterion_met")))
print("cancel proof", cancel.get("proof") if cancel else None)
for c in cases:
    s = c.get("stages") or {}
    print(
        f"{c['id']:5} {c['failure_bucket']:28} "
        f"q={s.get('qualified', 0):2} art={s.get('artifacts_found', 0):2} "
        f"bound={s.get('claims_subject_bound', 0):2} clar={c.get('clarify_count', 0)} "
        f"out={c['outcome']} ms={c['ms']}"
    )
    if c["id"] in ("A", "ADV1", "B", "E", "ADV6", "G"):
        print("      stages", dict(s))
        print("      ql_mem", c.get("qualified_lead_memory_persist"))
        print("      legacy", c.get("legacy_live_index_persist"))
        print("      sources", c.get("sources_succeeded"))
