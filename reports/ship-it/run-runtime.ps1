param([string]$Action = 'test', [string]$Query = 'Find SaaS founders globally who may need help with AI automation.')
$ErrorActionPreference = 'Continue'
$env:USE_PAID_SOURCES = 'false'
$env:SEARXNG_URL = 'http://127.0.0.1:8888'
$env:FORCE_COLOR = '0'
$env:E2E_BASE_URL = 'http://127.0.0.1:8082'
$env:V1_QUERY = $Query
if ($Action -eq 'start') {
  rtk proxy node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 8082 *> 'reports/ship-it/vite.log'
} elseif ($Action -eq 'ship') {
  rtk proxy node node_modules/@playwright/test/cli.js test e2e/ship-it.spec.ts --workers=1 --reporter=line --trace=off --output reports/ship-it/playwright-results *> 'reports/ship-it/ship-runtime.log'
  exit $LASTEXITCODE
} else {
  rtk proxy node node_modules/@playwright/test/cli.js test e2e/ship-it.spec.ts --workers=1 --reporter=line --trace=off --output reports/ship-it/playwright-results *> 'reports/ship-it/latest-runtime.log'
  exit $LASTEXITCODE
}
