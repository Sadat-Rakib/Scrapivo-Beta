param(
    [string]$Repo = 'C:\Users\mirsa\OneDrive\Desktop\Scrapivo (2)',
    [string]$WorkRoot = 'C:\ScrapivoGate2',
    [string]$Version = '2026-09-20-v1',
    [double]$MinFreeGB = 15,
    [int]$MaxRestarts = 20
)

$ErrorActionPreference = 'Stop'
$Python = 'C:\Users\mirsa\AppData\Local\Programs\Python\Python313\python.exe'
$IndexDir = Join-Path $WorkRoot 'scrapivo-index'
$CheckpointDir = Join-Path $WorkRoot 'scrapivo-checkpoints'
$LogDir = Join-Path $WorkRoot 'logs'
$Log = Join-Path $LogDir 'search-index-watchdog.log'
$PidFile = Join-Path $WorkRoot 'search-index-watchdog.pid'

New-Item -ItemType Directory -Force $IndexDir, $CheckpointDir, $LogDir | Out-Null
Set-Content -LiteralPath $PidFile -Value $PID

function Write-WatchdogLog([string]$Message) {
    $line = "$(Get-Date -Format o) $Message"
    Add-Content -LiteralPath $Log -Value $line
}

try {
    Set-Location $Repo
    for ($attempt = 1; $attempt -le $MaxRestarts; $attempt++) {
        $freeGB = (Get-PSDrive -Name C).Free / 1GB
        if ($freeGB -lt $MinFreeGB) {
            Write-WatchdogLog "PAUSED_LOW_DISK free_gb=$([math]::Round($freeGB, 2)) minimum_gb=$MinFreeGB"
            exit 20
        }

        Write-WatchdogLog "START attempt=$attempt version=$Version free_gb=$([math]::Round($freeGB, 2))"
        & $Python scripts/pipeline/build_search_index.py `
            --version $Version `
            --output-dir $IndexDir `
            --checkpoint-dir $CheckpointDir `
            --bucket-hex-chars 2 `
            --min-free-gb $MinFreeGB `
            --s3-profile scrapivo `
            --upload `
            --resume 2>&1 | ForEach-Object { Add-Content -LiteralPath $Log -Value $_ }
        $exitCode = $LASTEXITCODE

        if ($exitCode -eq 0) {
            Write-WatchdogLog "BUILD_COMPLETE version=$Version"
            exit 0
        }

        $freeGB = (Get-PSDrive -Name C).Free / 1GB
        if ($freeGB -lt $MinFreeGB) {
            Write-WatchdogLog "PAUSED_LOW_DISK exit_code=$exitCode free_gb=$([math]::Round($freeGB, 2))"
            exit 20
        }

        Write-WatchdogLog "RETRY exit_code=$exitCode attempt=$attempt wait_seconds=60"
        Start-Sleep -Seconds 60
    }

    Write-WatchdogLog "STOPPED_MAX_RESTARTS max_restarts=$MaxRestarts"
    exit 21
}
finally {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
