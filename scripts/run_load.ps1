param(
  [Parameter(Mandatory = $true)][string]$Model,
  [string[]]$Rates = @('0.05rps', '0.10rps', '0.20rps'),
  [int]$Runs = 3,
  [string]$JMeter = 'C:\meter\bin\jmeter.bat',
  [string]$HostIp = '192.168.86.33',
  [int]$CooldownSec = 30,
  [int]$PlanMinutes = 5,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$repo      = (Get-Location).Path
$modelDir  = $Model -replace '[:/]', '_'
$loadRoot  = Join-Path (Join-Path $repo 'results') 'load'
$modelRoot = Join-Path $loadRoot $modelDir
$register  = Join-Path $loadRoot 'run_register.csv'

if (-not (Test-Path $JMeter)) { throw "JMeter not found at '$JMeter'. Pass the right path with -JMeter." }
foreach ($r in $Rates) {
  $plan = Join-Path 'jmeter' "load_$r.jmx"
  if (-not (Test-Path $plan)) { throw "Missing plan '$plan'. Run this script from the repo root (the folder that contains jmeter\)." }
}
if (-not (Test-Path (Join-Path 'jmeter' 'load_data.txt'))) { throw "Missing jmeter\load_data.txt." }

try {
  $health = Invoke-RestMethod -Uri "http://${HostIp}:3000/health" -TimeoutSec 5
} catch {
  throw "Cannot reach the service at http://${HostIp}:3000/health. Check the desktop is running, its IP, and the firewall rule."
}
Write-Host "Service reachable at ${HostIp}:3000 (health: $($health.status))" -ForegroundColor Green

Write-Host ''
Write-Host "Model label for these results : $Model   ->   results\load\$modelDir\" -ForegroundColor Cyan
Write-Host "Plan: $($Rates.Count) rate(s) x $Runs run(s), $PlanMinutes min each, cooldown $CooldownSec s"
if (-not $Yes) {
  Write-Host ''
  Write-Host 'On the DESKTOP, confirm before continuing:'
  Write-Host "  docker compose exec triage-service printenv OLLAMA_MODEL      (must print $Model)"
  Write-Host '  the previous model has been unloaded (ollama stop <old model>)'
  Write-Host 'On THIS laptop: plugged in, Best performance, JMeter GUI closed, nothing else running.'
  $answer = Read-Host 'Type YES to start'
  if ($answer -ne 'YES') { throw 'Cancelled.' }
}

Write-Host 'Sending one warm-up ticket (not measured)...'
$warm = Invoke-RestMethod -Uri "http://${HostIp}:3000/tickets" -Method Post -ContentType 'application/json' -Body '{"narrative": "warm-up request"}' -TimeoutSec 600
Write-Host "Warm-up done (ticket $($warm.id))."

New-Item -ItemType Directory -Force $loadRoot | Out-Null
$total = $Runs * $Rates.Count
$i = 0
$started = Get-Date

for ($run = 1; $run -le $Runs; $run++) {
  foreach ($rate in $Rates) {
    $i++
    $dir = Join-Path $modelRoot $rate
    New-Item -ItemType Directory -Force $dir | Out-Null
    $jtl = Join-Path $dir "run$run.jtl"
    $tmp = "$jtl.tmp"
    $log = Join-Path $dir "run$run.log"
    $label = "[$i/$total] $Model $rate run$run"

    if (Test-Path $jtl) {
      Write-Host "$label : $jtl already exists - skipping (delete it to rerun)" -ForegroundColor Yellow
      continue
    }
    Remove-Item $tmp -ErrorAction SilentlyContinue      # leftover from an interrupted run

    $expected = [math]::Round(([double]($rate -replace 'rps', '')) * 60 * $PlanMinutes)
    Write-Host ''
    Write-Host "$label : starting (about $expected requests over $PlanMinutes min) ..." -ForegroundColor Cyan
    $t0 = (Get-Date).ToUniversalTime()

   
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $JMeter -n -t (Join-Path 'jmeter' "load_$rate.jmx") -l $tmp -j $log "-Jhost=$HostIp"
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    $t1 = (Get-Date).ToUniversalTime()

    if (-not (Test-Path $tmp)) { throw "$label : JMeter produced no results file (exit code $exitCode)." }
    $rows = @(Import-Csv $tmp)
    $errors = @($rows | Where-Object { $_.success -ne 'true' }).Count
    if ($exitCode -ne 0 -or $rows.Count -eq 0) {
      throw "$label : JMeter exit code $exitCode with $($rows.Count) result row(s). Partial file left at $tmp for inspection."
    }
    Move-Item $tmp $jtl

    $color = 'Green'
    if ($errors -gt 0) { $color = 'Red' }
    Write-Host ("$label : done. requests={0} (expected about {1}) errors={2}" -f $rows.Count, $expected, $errors) -ForegroundColor $color
    if ($errors -gt 0) { Write-Host '   Some requests failed - look at the success and responseMessage columns before using this run.' -ForegroundColor Red }

    [pscustomobject]@{
      model       = $Model
      rate        = $rate
      run         = $run
      start_utc   = $t0.ToString('o')
      end_utc     = $t1.ToString('o')
      rows        = $rows.Count
      errors      = $errors
      jmeter_exit = $exitCode
      jtl         = "results\load\$modelDir\$rate\run$run.jtl"
    } | Export-Csv -Path $register -Append -NoTypeInformation

    if ($i -lt $total -and $CooldownSec -gt 0) {
      Write-Host "   cooling down for $CooldownSec s ..."
      Start-Sleep -Seconds $CooldownSec
    }
  }
}

$mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
Write-Host ''
Write-Host "Finished $Model in $mins minutes. Results: results\load\$modelDir\   Register: results\load\run_register.csv" -ForegroundColor Green
Write-Host 'Next: switch the desktop to the next model, or commit these results (git add results; git commit; git push).'
