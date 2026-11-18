$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'desktop_snapshot.ps1')
$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $root ('.tools/snapshot-check-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot
$sourceJar = Join-Path $testRoot 'source.jar'
[System.IO.File]::WriteAllBytes($sourceJar, [byte[]](1,2,3,4))
$first = Get-DesktopSnapshot $sourceJar (Join-Path $testRoot 'cache')
$firstHash = (Get-FileHash -LiteralPath $first).Hash
[System.IO.File]::WriteAllBytes($sourceJar, [byte[]](5,6,7,8))
$second = Get-DesktopSnapshot $sourceJar (Join-Path $testRoot 'cache')
if ($first -eq $second -or (Get-FileHash -LiteralPath $first).Hash -ne $firstHash) { throw 'Source update changed the existing snapshot' }
$modified = (Get-Item -LiteralPath $second).LastWriteTimeUtc
$again = Get-DesktopSnapshot $sourceJar (Join-Path $testRoot 'cache')
if ($again -ne $second -or (Get-Item -LiteralPath $second).LastWriteTimeUtc -ne $modified) { throw 'Existing snapshot was rewritten' }
[System.IO.File]::WriteAllBytes($second, [byte[]](9,9))
$rejected = $false
try { $null = Get-DesktopSnapshot $sourceJar (Join-Path $testRoot 'cache') } catch { $rejected = $true }
if (-not $rejected) { throw 'Corrupt snapshot was accepted' }
$null = New-Item -ItemType Directory -Path (Join-Path $root 'reports/shutdown') -Force
[ordered]@{passed=$true;sourceUpdatesPreserveRunningSnapshot=$true;unchangedSnapshotsAreNotRewritten=$true;corruptSnapshotRejected=$true} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'reports/shutdown/snapshot-checks.json') -Encoding utf8
Write-Output 'Launcher snapshot checks passed.'
