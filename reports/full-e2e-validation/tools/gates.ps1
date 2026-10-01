# QA-only regression gates for the full E2E pass (no product code is touched).
#   powershell -ExecutionPolicy Bypass -File reports/full-e2e-validation/tools/gates.ps1 -Tag start [-Batteries]
# -Batteries also runs the understanding stress corpus and the adversarial battery.
# Those tools write into reports/mvp-release-candidate/, so their RC copies are
# backed up first and restored afterwards; this pass's outputs go to evidence/.
param([string]$Tag = "start", [switch]$Batteries)
$ErrorActionPreference = "Continue"
$root = "reports/full-e2e-validation"
$logs = "$root/logs"
$ev = "$root/evidence"
New-Item -ItemType Directory -Force -Path $logs, $ev | Out-Null
$s = [ordered]@{ tag = $Tag; started = (Get-Date).ToString("s"); branch = (git branch --show-current); head = (git rev-parse HEAD) }

$t = Get-Date
cmd /c "node reports/mvp-release-candidate/tools/vt.mjs --maxWorkers=2 > $logs\vt-$Tag.txt 2>&1"
$s.vt = (Select-String -Path "$logs\vt-$Tag.txt" -Pattern "total=" | Select-Object -Last 1).Line
$s.vtNewFailures = @(Select-String -Path "$logs\vt-$Tag.txt" -Pattern "^NEW " | ForEach-Object { $_.Line })
$s.vtSecs = [math]::Round(((Get-Date) - $t).TotalSeconds)

$t = Get-Date
$env:NODE_OPTIONS = '--max-old-space-size=3072'
cmd /c "npx tsc --noEmit > $logs\typecheck-$Tag.txt 2>&1"
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
$s.typecheck = (node "$root/tools/tsc-compare.mjs" "$logs/typecheck-$Tag.txt" | Select-Object -Last 1)
$s.typecheckSecs = [math]::Round(((Get-Date) - $t).TotalSeconds)

$t = Get-Date
cmd /c "set NODE_OPTIONS=--max-old-space-size=4096&& npm run build > $logs\build-$Tag.log 2>&1"
$s.buildExit = $LASTEXITCODE
$s.buildSecs = [math]::Round(((Get-Date) - $t).TotalSeconds)
$s.buildErrors = @(Select-String -Path "$logs\build-$Tag.log" -Pattern "errno=1455|JavaScript heap out of memory|\berror\b.*\bTS\d+|Build failed" | Select-Object -First 3 | ForEach-Object { $_.Line.Trim() })
if ($s.buildExit -eq 0) { $s.bundleScan = (node reports/mvp-release-candidate/tools/bundle-scan.mjs | Select-Object -Last 1) } else { $s.bundleScan = "SKIPPED (build failed)" }

if ($Batteries) {
  $rc = "reports/mvp-release-candidate"
  $protect = @("STRESS_RESULTS.json", "ADVERSARIAL.json", "ADVERSARIAL.md")
  $bak = Join-Path $env:TEMP "scrapivo-e2e-rc-backup"
  New-Item -ItemType Directory -Force -Path $bak | Out-Null
  foreach ($f in $protect) { Copy-Item "$rc/$f" "$bak/$f" -Force }
  cmd /c "npx tsx $rc/stress.mts > $logs\stress-$Tag.txt 2>&1"
  $s.stress = (Select-String -Path "$logs\stress-$Tag.txt" -Pattern '"policyAdjusted"' | Select-Object -Last 1).Line
  cmd /c "npx tsx $rc/tools/adversarial.mts > $logs\adversarial-$Tag.txt 2>&1"
  $s.adversarial = (Select-String -Path "$logs\adversarial-$Tag.txt" -Pattern "^PASSED" | Select-Object -Last 1).Line
  foreach ($f in $protect) { Copy-Item "$rc/$f" "$ev/$Tag-$f" -Force; Copy-Item "$bak/$f" "$rc/$f" -Force }
  Remove-Item $bak -Recurse -Force
  $s.rcFilesRestored = @(git status --porcelain -- ($protect | ForEach-Object { "$rc/$_" })).Count -eq 0
}

$s.finished = (Get-Date).ToString("s")
$s | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 "$ev/gates-$Tag.json"
"GATES_DONE $Tag"
