<#
.SYNOPSIS
  Runs the JMeter load tests for ONE model (or, with -Stress, the stress test).

.DESCRIPTION
  Run this on the load generator, from the repo root, after the service has been switched
  to the model you name.

  What it does differently

  1. EVERY REQUEST CARRIES A TICKET THAT HAS NOT BEEN SENT BEFORE in this model's session.
     Each run gets its own block of lines from jmeter\load_data.txt (the blocks never overlap).
     Reason: Ollama answers a ticket it has already seen far faster (the first load test showed repeats
     at a median of about 0.23 s against about 1.5 s for new tickets), and a real complaint desk only
     ever sees new tickets. Every model gets the same blocks, so models stay comparable.

  2. A DRAIN PERIOD IS ADDED to the end of the schedule: pause(N min).
     Reason: when the schedule ends JMeter interrupts any request still running, which records it as
     an error and cuts its latency short. For slow models at high rates there is a queue at the end,
     so the pause lets it finish. N is worked out from the model's measured service time; override
     with -DrainMin. A run that is still cut off is flagged in red so it can be rerun with a larger N.

  3. EACH RUN KEEPS ITS EVIDENCE: the exact plan that was run (run<N>.jmx), the exact tickets it sent
     (run<N>.data.txt), JMeter's log and the results. After the run the request sizes are compared with
     the tickets that were meant to be sent, so a wrong data file cannot go unnoticed.

  Runs are interleaved (run 1 of every rate, then run 2 of every rate, ...) to spread drift across rates.

  Output, per run (scripts/summarize_load.js reads the .jtl files):
    results\load\<model>\<rate>\run<N>.jtl / .jmx / .data.txt / .log
    results\load\run_register.csv      one row per run
  Stress test (-Stress): results\stress\<model>\stress.jtl / .jmx / .data.txt / .log

  A run whose .jtl already exists is skipped (JMeter would append to it). Results are written to
  <run>.jtl.tmp and renamed only when JMeter finishes, so an interrupted run leaves no half-finished .jtl.

.EXAMPLE
  .\scripts\run_load.ps1 -Model gemma3:1b
  .\scripts\run_load.ps1 -Model gemma3:1b -Stress
  .\scripts\run_load.ps1 -Model gemma3:1b -Rates 0.10rps,0.20rps
#>
param(
  [Parameter(Mandatory = $true)][string]$Model,
  [string[]]$Rates = @('0.05rps', '0.10rps', '0.20rps'),
  [int]$Runs = 3,
  [string]$JMeter = 'C:\meter\bin\jmeter.bat',
  [string]$HostIp = '192.168.86.33',
  [int]$CooldownSec = 0,
  [int]$DrainMin = 0,
  [switch]$Stress,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$repo       = (Get-Location).Path
$modelDir   = $Model -replace '[:/]', '_'
$loadRoot   = Join-Path (Join-Path $repo 'results') 'load'
$stressRoot = Join-Path (Join-Path $repo 'results') 'stress'
$register   = Join-Path $loadRoot 'run_register.csv'

# Mean response time of one request (seconds), measured in the accuracy runs (one request at a time).
$ServiceSec = @{ 'gemma3:1b' = 2.06; 'qwen2.5:3b' = 2.80; 'gemma3:4b' = 5.10; 'qwen2.5:7b' = 6.60; 'granite3.3:8b' = 8.89 }

# Which lines of load_data.txt each run uses. One run's block holds 105 lines (15 + 30 + 60); run 2 starts
# after run 1's block, and so on. The stress test uses lines 316 to 720. Fixed, so every model gets the same tickets.
$SliceCount  = @{ '0.05rps' = 15; '0.10rps' = 30; '0.20rps' = 60 }
$SliceOffset = @{ '0.05rps' = 0;  '0.10rps' = 15; '0.20rps' = 45 }
$BlockSize = 105; $StressFirst = 316; $StressCount = 405
$ArrivalSec = 300          # 5 minutes of arrivals in every load plan

function Get-DrainMin([double]$S, [int]$n, [double]$rps) {
  $rho = $rps * $S
  $sec = 30 + 10 * $S + [math]::Max(0, $n * $S * 1.1 - $ArrivalSec)
  if ($rho -ge 0.7 -and $rho -lt 1.0) { $sec += 15 * $S }
  return [int][math]::Max(1, [math]::Ceiling($sec / 60))
}

# ---- pre-flight checks -------------------------------------------------------
if (-not (Test-Path $JMeter)) { throw "JMeter not found at '$JMeter'. Pass the right path with -JMeter." }
$dataFile = Join-Path (Join-Path $repo 'jmeter') 'load_data.txt'
if (-not (Test-Path $dataFile)) { throw "Missing jmeter\load_data.txt. Run this script from the repo root." }
$allLines = @([System.IO.File]::ReadAllLines($dataFile) | Where-Object { $_.Trim() -ne '' })
if ($allLines.Count -lt ($StressFirst + $StressCount - 1)) { throw "load_data.txt has $($allLines.Count) lines; at least $($StressFirst + $StressCount - 1) are needed." }

$S = 0.0
if ($ServiceSec.ContainsKey($Model)) { $S = [double]$ServiceSec[$Model] }
if ($DrainMin -le 0 -and -not $Stress -and $S -le 0) { throw "No service time known for '$Model'. Pass -DrainMin explicitly." }

# ---- the list of runs --------------------------------------------------------
$jobs = @()
if ($Stress) {
  $drain = $DrainMin; if ($drain -le 0) { $drain = 4 }
  $template = Join-Path (Join-Path $repo 'jmeter') 'stress_ramp.jmx'
  if (-not (Test-Path $template)) { throw "Missing plan 'jmeter\stress_ramp.jmx'." }
  $jobs += [pscustomobject]@{ run = 1; rate = 'stress'; template = $template; first = $StressFirst; count = $StressCount; drain = $drain; minutes = 15 }
} else {
  foreach ($r in $Rates) {
    if (-not $SliceCount.ContainsKey($r)) { throw "Unknown rate '$r'. Known rates: $($SliceCount.Keys -join ', ')." }
    $t = Join-Path (Join-Path $repo 'jmeter') "load_$r.jmx"
    if (-not (Test-Path $t)) { throw "Missing plan 'jmeter\load_$r.jmx'. Run this script from the repo root." }
  }
  for ($run = 1; $run -le $Runs; $run++) {
    foreach ($r in $Rates) {
      $rps = [double]($r -replace 'rps', '')
      $drain = $DrainMin; if ($drain -le 0) { $drain = Get-DrainMin $S $SliceCount[$r] $rps }
      $jobs += [pscustomobject]@{
        run = $run; rate = $r; template = (Join-Path (Join-Path $repo 'jmeter') "load_$r.jmx")
        first = (($run - 1) * $BlockSize + $SliceOffset[$r] + 1); count = $SliceCount[$r]; drain = $drain; minutes = 5
      }
    }
  }
}
$maxLine = ($jobs | ForEach-Object { $_.first + $_.count - 1 } | Measure-Object -Maximum).Maximum
if ($maxLine -gt $allLines.Count) { throw "These runs need $maxLine lines of load_data.txt but it has $($allLines.Count)." }

try {
  $health = Invoke-RestMethod -Uri "http://${HostIp}:3000/health" -TimeoutSec 5
} catch {
  throw "Cannot reach the service at http://${HostIp}:3000/health. Check the desktop is running, its IP, and the firewall rule."
}
Write-Host "Service reachable at ${HostIp}:3000 (health: $($health.status))" -ForegroundColor Green

$totalMin = ($jobs | ForEach-Object { $_.minutes + $_.drain + 1 } | Measure-Object -Sum).Sum
Write-Host ''
Write-Host "Model label for these results : $Model" -ForegroundColor Cyan
Write-Host ("{0} run(s), about {1} minutes in total (arrivals + drain + about 1 minute for JMeter to exit)" -f $jobs.Count, $totalMin)
$jobs | ForEach-Object { Write-Host ("   run{0} {1,-8} tickets {2}-{3}  drain {4} min" -f $_.run, $_.rate, $_.first, ($_.first + $_.count - 1), $_.drain) }
if (-not $Yes) {
  Write-Host ''
  Write-Host 'On the DESKTOP, confirm before continuing:'
  Write-Host "  docker compose exec triage-service printenv OLLAMA_MODEL      (must print $Model)"
  Write-Host '  the previous model has been unloaded (ollama stop <old model>)'
  Write-Host 'On THIS laptop: plugged in, Best performance, sleep off, JMeter GUI closed, nothing heavy running.'
  $answer = Read-Host 'Type YES to start'
  if ($answer -ne 'YES') { throw 'Cancelled.' }
}

# ---- warm-up so the first measured request is not a cold start ----------------
Write-Host 'Sending one warm-up ticket (not measured)...'
$warm = Invoke-RestMethod -Uri "http://${HostIp}:3000/tickets" -Method Post -ContentType 'application/json' -Body '{"narrative": "warm-up request"}' -TimeoutSec 600
Write-Host "Warm-up done (ticket $($warm.id))."

New-Item -ItemType Directory -Force $loadRoot | Out-Null
$total = $jobs.Count
$i = 0
$started = Get-Date

foreach ($job in $jobs) {
  $i++
  if ($Stress) {
    $dir = Join-Path $stressRoot $modelDir
    $base = 'stress'
    $label = "[$i/$total] $Model stress test"
  } else {
    $dir = Join-Path (Join-Path $loadRoot $modelDir) $job.rate
    $base = "run$($job.run)"
    $label = "[$i/$total] $Model $($job.rate) run$($job.run)"
  }
  New-Item -ItemType Directory -Force $dir | Out-Null
  $jtl = Join-Path $dir "$base.jtl"
  $tmp = "$jtl.tmp"
  $log = Join-Path $dir "$base.log"
  $planOut = Join-Path $dir "$base.jmx"
  $dataOut = Join-Path $dir "$base.data.txt"

  if (Test-Path $jtl) {
    Write-Host "$label : $jtl already exists - skipping (delete it to rerun)" -ForegroundColor Yellow
    continue
  }
  Remove-Item $tmp -ErrorAction SilentlyContinue      # leftover from an interrupted run

  # this run's own tickets
  $slice = @($allLines[($job.first - 1)..($job.first + $job.count - 2)])
  [System.IO.File]::WriteAllLines($dataOut, [string[]]$slice, (New-Object System.Text.ASCIIEncoding))

  # this run's own plan: the template with the schedule extended by a drain period, reading this run's tickets
  $tpl = [System.IO.File]::ReadAllText($job.template)
  $schedPattern = 'name="OpenModelThreadGroup.schedule">[^<]*<'
  $filePattern  = 'name="filename">[^<]*<'
  if ([regex]::Matches($tpl, $schedPattern).Count -ne 1 -or [regex]::Matches($tpl, $filePattern).Count -ne 1) {
    throw "$label : template '$($job.template)' does not have exactly one schedule and one filename property."
  }
  if ($Stress) {
    $schedule = [regex]::Match($tpl, 'name="OpenModelThreadGroup.schedule">([^<]*)<').Groups[1].Value.Trim() + " pause($($job.drain) min)"
  } else {
    $perMin = [int][math]::Round(([double]($job.rate -replace 'rps', '')) * 60)
    $schedule = "rate($perMin/min) random_arrivals($($job.minutes) min) rate($perMin/min) pause($($job.drain) min)"
  }
  $plan = $tpl -replace '(name="OpenModelThreadGroup.schedule">)[^<]*(<)', ('${1}' + $schedule + '${2}')
  $plan = $plan -replace '(name="filename">)[^<]*(<)', ('${1}' + "$base.data.txt" + '${2}')
  [System.IO.File]::WriteAllText($planOut, $plan, (New-Object System.Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host "$label : starting. schedule: $schedule" -ForegroundColor Cyan
  Write-Host "   $($job.count) tickets (lines $($job.first)-$($job.first + $job.count - 1) of load_data.txt)"
  $t0 = (Get-Date).ToUniversalTime()

  # JMeter writes warnings to stderr; Windows PowerShell 5.1 would treat those as errors in 'Stop' mode.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $JMeter -n -t $planOut -l $tmp -j $log "-Jhost=$HostIp"
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  $t1 = (Get-Date).ToUniversalTime()

  if (-not (Test-Path $tmp)) { throw "$label : JMeter produced no results file (exit code $exitCode)." }
  $rows = @(Import-Csv $tmp)
  if ($exitCode -ne 0 -or $rows.Count -eq 0) {
    throw "$label : JMeter exit code $exitCode with $($rows.Count) result row(s). Partial file left at $tmp for inspection."
  }
  $errors = @($rows | Where-Object { $_.success -ne 'true' }).Count
  $cut = @($rows | Where-Object { $_.responseMessage -like '*Socket Closed*' -or $_.responseCode -like 'Non HTTP*' }).Count

  # did JMeter really send the tickets it was meant to? compare the request sizes with the ticket sizes
  $dataOk = $true
  if ($cut -eq 0) {
    $obs = @($rows | ForEach-Object { [int]$_.sentBytes } | Sort-Object)
    $exp = @($slice | ForEach-Object { $_.Length } | Sort-Object)
    if ($obs.Count -ne $exp.Count) { $dataOk = $false }
    else {
      $diffs = @(); for ($k = 0; $k -lt $obs.Count; $k++) { $diffs += ($obs[$k] - $exp[$k]) }
      $spread = ($diffs | Measure-Object -Maximum -Minimum); if (($spread.Maximum - $spread.Minimum) -gt 2) { $dataOk = $false }
    }
  }
  Move-Item $tmp $jtl

  $bad = ($errors -gt 0 -or $cut -gt 0 -or -not $dataOk)
  $color = 'Green'; if ($bad) { $color = 'Red' }
  $dataText = 'ok'; if (-not $dataOk) { $dataText = 'MISMATCH' }
  Write-Host ("$label : done. requests={0} (expected {1}) errors={2} cut-off={3} data-check={4}" -f $rows.Count, $job.count, $errors, $cut, $dataText) -ForegroundColor $color
  if ($cut -gt 0) { Write-Host "   $cut request(s) were still running when the schedule ended and were cut off. Delete this run's .jtl and rerun with a larger -DrainMin (now $($job.drain))." -ForegroundColor Red }
  elseif ($errors -gt 0) { Write-Host '   Some requests failed - look at the success and responseMessage columns before using this run.' -ForegroundColor Red }
  if (-not $dataOk) { Write-Host '   The request sizes do not match the tickets that should have been sent. Do not use this run until you know why.' -ForegroundColor Red }

  [pscustomobject]@{
    model       = $Model
    rate        = $job.rate
    run         = $job.run
    start_utc   = $t0.ToString('o')
    end_utc     = $t1.ToString('o')
    rows        = $rows.Count
    errors      = $errors
    cut_off     = $cut
    data_ok     = $dataOk
    drain_min   = $job.drain
    first_line  = $job.first
    last_line   = ($job.first + $job.count - 1)
    jmeter_exit = $exitCode
    jtl         = $jtl.Substring($repo.Length + 1)
  } | Export-Csv -Path $register -Append -NoTypeInformation

  if ($i -lt $total -and $CooldownSec -gt 0) {
    Write-Host "   cooling down for $CooldownSec s ..."
    Start-Sleep -Seconds $CooldownSec
  }
}

$mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
Write-Host ''
Write-Host "Finished $Model in $mins minutes. Register: results\load\run_register.csv" -ForegroundColor Green
if ($Stress) { Write-Host "Next: node scripts/analyse_stress.js results\stress\$modelDir\stress.jtl   (on a machine with Node)" }
else { Write-Host 'Next: switch the desktop to the next model, or commit these results (git add results/load; git commit; git push).' }
