<#
.SYNOPSIS
  A2 speed test: ONE run of ONE configuration, from the LAPTOP (load generator).

.DESCRIPTION
  Before every run, on the DESKTOP:   scripts/a2_desktop_reset.sh <config>
  Then, on the LAPTOP, from the repo root:
      .\scripts\a2_run_speed.ps1 -Config <qwen7b|cascadeA|cascadeB> -Run <1|2|3>

  Steps (brief, Step 4 "Each run"):
   1. pre-flight: service /health; Ollama on the desktop has NO model loaded (proves the desktop was just
      reset, so the prompt cache is empty); Ollama version and model digests (weights layer, via /api/show)
   2. the 3 fixed warm-up tickets (jmeter/a2/warmup.txt), one at a time, timings discarded
   3. /api/ps must list the models this config uses (cascade: BOTH gemma3:4b and qwen2.5:7b)
   4. GET /stats total (before)
   5. JMeter, open model: rate one ticket per 2S s, random arrivals for the run length, then a pause longer
      than the response timeout (all from results/a2/speed/s_measurement.json); fixed workload in fixed order
   6. GET /stats total (after): the increase = requests the service completed and stored
   7. checks: rows vs expected, errors, cut-off/unfinished requests, request sizes vs intended tickets
   8. writes results/a2/speed/<config>/run<N>.jtl/.jmx/.data.txt/.log/.meta.json and a row in
      results/a2/speed/run_register.csv

  A run whose .jtl already exists is refused (delete it to rerun, and say so in the report).

.EXAMPLE
  .\scripts\a2_run_speed.ps1 -Config qwen7b -Run 1
  .\scripts\a2_run_speed.ps1 -Config cascadeA -Run 2 -HostIp 192.168.86.33 -JMeter C:\meter\bin\jmeter.bat
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('qwen7b', 'cascadeA', 'cascadeB')][string]$Config,
  [Parameter(Mandatory = $true)][ValidateRange(1, 9)][int]$Run,
  [string]$JMeter = 'C:\meter\bin\jmeter.bat',
  [string]$HostIp = '192.168.86.33',
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'

$repo = (Get-Location).Path
$a2 = Join-Path $repo 'jmeter\a2'
$speed = Join-Path $repo 'results\a2\speed'
$sFile = Join-Path $speed 's_measurement.json'
$register = Join-Path $speed 'run_register.csv'

$Expected = @{
  'qwen7b'   = @('qwen2.5:7b')
  'cascadeA' = @('gemma3:4b', 'qwen2.5:7b')
  'cascadeB' = @('gemma3:4b', 'qwen2.5:7b')
}[$Config]
$Digest = @{
  'qwen2.5:7b' = '2bada8a7450677000f678be90653b85d364de7db25eb5ea54136ada5f3933730'
  'gemma3:4b'  = 'aeda25e63ebd698fab8638ffb778e68bed908b960d39d0becc650fa981609d25'
}
$OllamaVersion = '0.34.4'
$svc = "http://${HostIp}:3000"
$oll = "http://${HostIp}:11434"

# ---- parameters from the measured S -----------------------------------------
if (-not (Test-Path $JMeter)) { throw "JMeter not found at '$JMeter'. Pass -JMeter." }
if (-not (Test-Path $sFile)) { throw "Missing $sFile. Measure S first (scripts/a2_measure_s.py on the desktop) and pull." }
$p = Get-Content $sFile -Raw | ConvertFrom-Json
$ratePerMin = [double]$p.rate_per_min
$runSec = [int]$p.run_seconds
$timeoutSec = [int]$p.response_timeout_seconds
$pauseMin = [int]$p.pause_minutes
$expectedReq = [int]$p.expected_requests_per_run
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$schedule = 'rate({0}/min) random_arrivals({1} sec) pause({2} min)' -f $ratePerMin.ToString('0.####', $inv), $runSec, $pauseMin

$dir = Join-Path $speed $Config
New-Item -ItemType Directory -Force $dir | Out-Null
$base = "run$Run"
$jtl = Join-Path $dir "$base.jtl"; $tmp = "$jtl.tmp"; $log = Join-Path $dir "$base.log"
$planOut = Join-Path $dir "$base.jmx"; $dataOut = Join-Path $dir "$base.data.txt"; $metaOut = Join-Path $dir "$base.meta.json"
if (Test-Path $jtl) { throw "$jtl already exists. Delete it to rerun (and record why in the decisions log)." }
Remove-Item $tmp -ErrorAction SilentlyContinue

# ---- 1. pre-flight ------------------------------------------------------------
$health = Invoke-RestMethod -Uri "$svc/health" -TimeoutSec 10
$ver = (Invoke-RestMethod -Uri "$oll/api/version" -TimeoutSec 10).version
if ($ver -ne $OllamaVersion) { throw "Ollama version $ver, expected $OllamaVersion." }
$loaded = @((Invoke-RestMethod -Uri "$oll/api/ps" -TimeoutSec 10).models | ForEach-Object { $_.name })
if ($loaded.Count -gt 0) {
  throw "Ollama already has model(s) loaded: $($loaded -join ', '). Run scripts/a2_desktop_reset.sh $Config on the desktop first (it clears the prompt cache)."
}
foreach ($m in $Expected) {
  $show = Invoke-RestMethod -Uri "$oll/api/show" -Method Post -ContentType 'application/json' -Body (@{ model = $m } | ConvertTo-Json) -TimeoutSec 30
  if ($show.modelfile -notmatch [regex]::Escape("sha256-$($Digest[$m])")) { throw "Digest mismatch for $m (weights layer is not $($Digest[$m]))." }
}
Write-Host "Pre-flight OK: service $($health.status), Ollama $ver, nothing loaded, digests OK for $($Expected -join ', ')." -ForegroundColor Green
Write-Host "Config $Config run $Run | schedule: $schedule | timeout ${timeoutSec}s | expected ~$expectedReq requests"
if (-not $Yes) {
  Write-Host 'Laptop: plugged in, Best performance, sleep off, JMeter GUI closed, nothing heavy running.'
  if ((Read-Host 'Type YES to start') -ne 'YES') { throw 'Cancelled.' }
}

# ---- 2. warm-ups (discarded) ----------------------------------------------------
$warm = @()
foreach ($body in [System.IO.File]::ReadAllLines((Join-Path $a2 'warmup.txt'))) {
  if (-not $body.Trim()) { continue }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-RestMethod -Uri "$svc/tickets" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 900
  $sw.Stop()
  $warm += [pscustomobject]@{ id = $r.id; category = $r.category; seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2) }
  Write-Host ("   warm-up -> {0} in {1:N1} s (discarded)" -f $r.category, $sw.Elapsed.TotalSeconds)
}

# ---- 3. the right models are resident -----------------------------------------
$ps = (Invoke-RestMethod -Uri "$oll/api/ps" -TimeoutSec 10).models
$loaded = @($ps | ForEach-Object { $_.name })
foreach ($m in $Expected) { if ($loaded -notcontains $m) { throw "After warm-up, ollama ps lists [$($loaded -join ', ')] but not $m. Do not start the run." } }
Write-Host "ollama ps after warm-up: $($loaded -join ', ')" -ForegroundColor Green

# ---- 4. /stats before ----------------------------------------------------------
$statsBefore = (Invoke-RestMethod -Uri "$svc/stats" -TimeoutSec 10).total

# ---- 5. JMeter -----------------------------------------------------------------
Copy-Item (Join-Path $a2 'workload.txt') $dataOut
$tickets = @([System.IO.File]::ReadAllLines($dataOut) | Where-Object { $_.Trim() })
if ($tickets.Count -lt $expectedReq + 5) { throw "workload.txt has $($tickets.Count) tickets; need at least $($expectedReq + 5)." }
$tpl = [System.IO.File]::ReadAllText((Join-Path $a2 'speed_template.jmx'))
$plan = $tpl.Replace('__SCHEDULE__', $schedule).Replace('__DATAFILE__', "$base.data.txt").Replace('__TIMEOUT_MS__', [string]($timeoutSec * 1000))
[System.IO.File]::WriteAllText($planOut, $plan, (New-Object System.Text.UTF8Encoding($false)))

$t0 = (Get-Date).ToUniversalTime()
Write-Host "JMeter started $($t0.ToString('o')). Arrivals for $runSec s, then up to $pauseMin min for slow requests to finish." -ForegroundColor Cyan
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& $JMeter -n -t $planOut -l $tmp -j $log "-Jhost=$HostIp"
$exit = $LASTEXITCODE; $ErrorActionPreference = $prev
$t1 = (Get-Date).ToUniversalTime()

# ---- 6. /stats after -----------------------------------------------------------
$statsAfter = (Invoke-RestMethod -Uri "$svc/stats" -TimeoutSec 10).total
$psAfter = @((Invoke-RestMethod -Uri "$oll/api/ps" -TimeoutSec 10).models | ForEach-Object { $_.name })

# ---- 7. checks -----------------------------------------------------------------
if (-not (Test-Path $tmp)) { throw "JMeter produced no results file (exit code $exit)." }
$rows = @(Import-Csv $tmp)
if ($exit -ne 0 -or $rows.Count -eq 0) { throw "JMeter exit code $exit with $($rows.Count) row(s). Partial file left at $tmp." }
$ok = @($rows | Where-Object { $_.success -eq 'true' })
$errors = $rows.Count - $ok.Count
$cut = @($rows | Where-Object { $_.responseMessage -like '*Socket Closed*' -or $_.responseCode -like 'Non HTTP*' }).Count
$completedBySvc = $statsAfter - $statsBefore
$obs = @($rows | ForEach-Object { [int]$_.sentBytes } | Sort-Object)
$exp = @($tickets[0..($rows.Count - 1)] | ForEach-Object { $_.Length } | Sort-Object)
$diffs = @(); for ($k = 0; $k -lt $obs.Count; $k++) { $diffs += ($obs[$k] - $exp[$k]) }
$spread = $diffs | Measure-Object -Maximum -Minimum
$dataOk = ($cut -eq 0) -and (($spread.Maximum - $spread.Minimum) -le 2)
Move-Item $tmp $jtl

$meta = [ordered]@{
  config = $Config; run = $Run; start_utc = $t0.ToString('o'); end_utc = $t1.ToString('o')
  schedule = $schedule; response_timeout_s = $timeoutSec; S_seconds = $p.S_seconds
  expected_requests = $expectedReq; sent = $rows.Count; succeeded = $ok.Count; errored = $errors; unfinished_cut_off = $cut
  stats_before = $statsBefore; stats_after = $statsAfter; completed_by_service = $completedBySvc
  data_ok = $dataOk; jmeter_exit = $exit; warmups = $warm; ollama_ps_after_warmup = $loaded; ollama_ps_after_run = $psAfter
  host = $HostIp; jtl = $jtl.Substring($repo.Length + 1)
}
$meta | ConvertTo-Json -Depth 4 | Set-Content -Path $metaOut -Encoding UTF8
[pscustomobject]@{
  config = $Config; run = $Run; start_utc = $meta.start_utc; end_utc = $meta.end_utc; sent = $rows.Count; succeeded = $ok.Count
  errored = $errors; unfinished = $cut; stats_delta = $completedBySvc; data_ok = $dataOk; schedule = $schedule; jtl = $meta.jtl
} | Export-Csv -Path $register -Append -NoTypeInformation

$bad = ($errors -gt 0 -or $cut -gt 0 -or -not $dataOk -or $completedBySvc -ne $ok.Count)
$color = 'Green'; if ($bad) { $color = 'Red' }
Write-Host ("Done: sent={0} (expected ~{1}) ok={2} errors={3} unfinished={4} /stats delta={5} data-check={6}" -f $rows.Count, $expectedReq, $ok.Count, $errors, $cut, $completedBySvc, $dataOk) -ForegroundColor $color
if ($completedBySvc -ne $ok.Count) { Write-Host "   /stats increase ($completedBySvc) differs from JMeter successes ($($ok.Count)). Report it; do not discard the run." -ForegroundColor Red }
Write-Host "Next: commit results/a2/speed/$Config (jtl, jmx, data, log, meta) and the register; then reset the desktop before the next run."
