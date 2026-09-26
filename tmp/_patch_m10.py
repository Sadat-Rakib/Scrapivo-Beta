from pathlib import Path
import re
p = Path("src/lib/search/__tests__/m10-persistence.test.ts")
t = p.read_text(encoding="utf-8")
t = t.replace("await persistQualifiedLead(", "persistQualifiedLead(")
t = t.replace("persistQualifiedLead(", "await persistQualifiedLead(")
t = re.sub(r'it\(("([^"\\]|\\.)*")\s*,\s*\(\)\s*=>', r"it(\1, async () =>", t)
t = re.sub(r"it\(('([^'\\]|\\.)*')\s*,\s*\(\)\s*=>", r"it(\1, async () =>", t)
t = t.replace("async async () =>", "async () =>")
p.write_text(t, encoding="utf-8")
print("ok", t.count("await persistQualifiedLead"))
