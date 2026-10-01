# QA-only understanding battery: runs each query through the product's understanding
# chain (tools/understand.mts; LLM path, then deterministic) and keeps the criteria.
$ErrorActionPreference = "Continue"
$out = "reports/full-e2e-validation/evidence/parse-battery.jsonl"
if (Test-Path $out) { Remove-Item $out }
$queries = @(
  "People looking for a web designer", "People looking for a web designer",
  "Founders complaining about lead generation", "Businesses saying they need a new website",
  "People looking for an SEO agency", "Founders discussing hiring their first salesperson",
  "yo find me saas founders canada need sales help email if possible",
  "need dentists portland phone number", "find startup founders worldwide building fintech",
  "copywriters toronto email", "hvac gta phone", "saas founders public contact details",
  "Plumbers in Edmonton with public contact details", "Roofers in Mississauga with phone numbers",
  "dentists in calgery with websites", "Marketing agencies in Vancouver or Seattle",
  "Copywriters and web designers in Toronto", "SaaS founders in Canada, no email needed",
  "Plumbers in Austin without a website", "Fractional CMOs in Canada",
  "Recruiters hiring software engineers", "Fintech companies in Toronto with 50 to 200 employees",
  "Pre-seed investors in Canada investing in SaaS", "Data engineer jobs in Berlin with salary",
  "Remote frontend developer jobs", "AI founders globally hiring their first sales rep"
)
$i = 0
foreach ($q in $queries) {
  $i++
  foreach ($mode in @("llm", "det")) {
    $flag = if ($mode -eq "det") { "--det" } else { "" }
    $t0 = Get-Date
    $raw = cmd /c "npx tsx reports/mvp-release-candidate/tools/understand.mts ""$q"" $flag 2>&1" | Out-String
    $crit = [regex]::Matches($raw, '"([a-z_]+=[^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    $entity = ([regex]::Match($raw, '"entity":\s*"([a-z]+)"')).Groups[1].Value
    $status = ([regex]::Match($raw, '"status":\s*"([a-z_]+)"')).Groups[1].Value
    $decision = ([regex]::Match($raw, '"decision":\s*"([a-z_]+)"')).Groups[1].Value
    [ordered]@{ n = $i; query = $q; mode = $mode; entity = $entity; status = $status; decision = $decision; criteria = @($crit); secs = [math]::Round(((Get-Date) - $t0).TotalSeconds) } | ConvertTo-Json -Compress | Add-Content -Encoding utf8 $out
  }
}
"PARSE_DONE"
