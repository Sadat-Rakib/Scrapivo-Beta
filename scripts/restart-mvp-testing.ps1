param([int]$Port = 8788, [switch]$SkipVercel)
& (Join-Path $PSScriptRoot 'stop-mvp-testing.ps1')
& (Join-Path $PSScriptRoot 'start-mvp-testing.ps1') -Port $Port -SkipVercel:$SkipVercel
