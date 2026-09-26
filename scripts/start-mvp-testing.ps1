param([int]$Port = 8788, [switch]$SkipVercel)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$root = 'C:\ScrapivoBrowserWorker'
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$tokenPath = Join-Path $root 'worker.token'
$token = $env:SCRAPIVO_BROWSER_WORKER_TOKEN
if (-not $token -and (Test-Path $tokenPath)) { $token = (Get-Content $tokenPath -Raw).Trim() }
if (-not $token) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $token = [Convert]::ToBase64String($bytes)
  Set-Content -LiteralPath $tokenPath -Value $token -NoNewline
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner([System.Security.Principal.WindowsIdentity]::GetCurrent().User)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'Allow')))
  Set-Acl -LiteralPath $tokenPath -AclObject $acl
}
$env:SCRAPIVO_BROWSER_WORKER_TOKEN = $token
$env:RESEARCH_WORKER_PORT = "$Port"
Set-Location $repo
$cloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflared = if ($cloudflaredCommand) { $cloudflaredCommand.Source } else {
  Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'cloudflared.exe' -File -Recurse -ErrorAction Stop |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cloudflared) { throw 'cloudflared executable not found' }
$worker = Start-Process -FilePath 'node.exe' -ArgumentList '--import','tsx','src\research-worker\server.ts' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'worker.log') -RedirectStandardError (Join-Path $logs 'worker.err.log')
for ($i=0; $i -lt 30; $i++) { try { Invoke-RestMethod "http://127.0.0.1:$Port/health" | Out-Null; break } catch { Start-Sleep 1 } }
$tunnelLog = Join-Path $logs 'cloudflared.log'
$tunnelErr = Join-Path $logs 'cloudflared.err.log'
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList 'tunnel','--url',"http://127.0.0.1:$Port" -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErr
$url = $null
for ($i=0; $i -lt 45 -and -not $url; $i++) {
  Start-Sleep 1
  $text = ((Get-Content $tunnelLog,$tunnelErr -ErrorAction SilentlyContinue) -join "`n")
  $url = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com').Value
}
if (-not $url) { throw 'Quick Tunnel URL not detected' }
$publicHealthy = $false
for ($i=0; $i -lt 30; $i++) { try { Invoke-RestMethod "$url/health" | Out-Null; $publicHealthy = $true; break } catch { Start-Sleep 1 } }
if (-not $publicHealthy) { Write-Warning 'Quick Tunnel DNS/health is not available through the current local resolver yet; the tunnel remains running for propagation.' }
$state = @{ workerPort=$Port; quickTunnelUrl=$url; workerPid=$worker.Id; tunnelPid=$tunnel.Id; startedAt=(Get-Date).ToString('o') }
$state | ConvertTo-Json | Set-Content (Join-Path $root 'runtime.json')
if (-not $SkipVercel) {
  $url | & vercel env add BROWSER_WORKER_URL production --force | Out-Null
  $token | & vercel env add BROWSER_WORKER_TOKEN production --force | Out-Null
  'true' | & vercel env add USE_RESEARCH_AGENT_DISCOVER production --force | Out-Null
  Write-Warning 'Environment updated. Deploy verified main through the existing Git-triggered Vercel deployment.'
}
Write-Host "READY $url"
