$statePath = 'C:\ScrapivoBrowserWorker\runtime.json'
if (-not (Test-Path $statePath)) { Write-Host 'Not started.'; exit 1 }
$state = Get-Content $statePath -Raw | ConvertFrom-Json
$worker = try { (Invoke-RestMethod "http://127.0.0.1:$($state.workerPort)/health").status -eq 'ok' } catch { $false }
$tunnel = !!(Get-Process -Id $state.tunnelPid -ErrorAction SilentlyContinue)
$health = try { (Invoke-RestMethod "$($state.quickTunnelUrl)/health").status } catch { 'unavailable' }
[pscustomobject]@{ workerRunning=$worker; tunnelRunning=$tunnel; publicUrl=$state.quickTunnelUrl; publicHealth=$health }
