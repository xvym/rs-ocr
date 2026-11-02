param(
    [string]$Image,
    [string]$Directory,
    [ValidateSet('native','gba-5x','ngc-capture')][string]$Profile,
    [string]$Viewport,
    [string]$Out = "$PSScriptRoot/reports/ocr-development/result.json",
    [string]$Normalized,
    [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
if ([bool]$Image -eq [bool]$Directory) { throw '请指定 -Image 或 -Directory。' }
if ([bool]$Profile -eq [bool]$Viewport) { throw '请指定 -Profile 或 -Viewport。' }
$jar = Join-Path $PSScriptRoot 'target/rs-ocr-0.1.0.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw '请先运行 build.ps1 完成构建。' }
$java = if ($JavaHome) { Join-Path $JavaHome 'bin/java.exe' } else { 'java' }
$arguments = @('-jar', $jar, '--out', $Out)
if ($Image) { $arguments += @('--image', $Image) } else { $arguments += @('--directory', $Directory) }
if ($Profile) { $arguments += @('--profile', $Profile) } else { $arguments += @('--viewport', $Viewport) }
if ($Normalized) { $arguments += @('--normalized', $Normalized) }
& $java @arguments
if ($LASTEXITCODE -ne 0) { throw '识别失败，请查看上方错误信息。' }
Write-Host "识别结果已写入：$Out"
