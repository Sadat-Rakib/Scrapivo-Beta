foreach ($port in @(8080, 8081)) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conns) {
    foreach ($c in $conns) {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      Write-Output ("killed " + $c.OwningProcess + " on " + $port)
    }
  } else {
    Write-Output ("none on " + $port)
  }
}
