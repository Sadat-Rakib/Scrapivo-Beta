$statePath = 'C:\ScrapivoBrowserWorker\runtime.json'
if (Test-Path $statePath) {
  $state = Get-Content $statePath -Raw | ConvertFrom-Json
  foreach ($id in @($state.workerPid,$state.tunnelPid)) { Stop-Process -Id $id -ErrorAction SilentlyContinue }
}
Write-Host 'MVP testing processes stopped.'
