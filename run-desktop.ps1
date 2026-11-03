param(
    [string]$Image, [string]$Directory,
    [ValidateSet('auto','native','gba-5x','ngc-capture')][string]$Profile = 'auto',
    [string]$JavaHome,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
if ($Image -and $Directory) { throw '请只指定图片或目录中的一个。' }
$jar = Join-Path $PSScriptRoot 'desktop/target/rs-ocr-desktop-0.1.0.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw '请先运行 build-desktop.ps1。' }
function Get-JavaMajor([string]$Executable) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = '-version'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardOutput = $true
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::Start($info)
        $version = $process.StandardError.ReadToEnd() + $process.StandardOutput.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -eq 0 -and $version -match 'version "(\d+)(?:\.(\d+))?') {
            if ($Matches[1] -eq '1') { return [int]$Matches[2] }
            return [int]$Matches[1]
        }
    } catch { return 0 } finally { if ($process) { $process.Dispose() } }
    return 0
}
$candidates = @()
if ($JavaHome) {
    $candidates += Join-Path $JavaHome 'bin/java.exe'
} else {
    if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME 'bin/java.exe' }
    # Prefer project-local runtimes, then reuse the existing sibling development toolchain.
    foreach ($tools in @((Join-Path $PSScriptRoot '.tools'), (Join-Path $PSScriptRoot '../g1-ocr/.tools'))) {
        $candidates += Get-ChildItem -LiteralPath $tools -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'bin/java.exe' }
    }
    $onPath = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }
}
$java = $null
foreach ($candidate in ($candidates | Select-Object -Unique)) {
    $gui = Join-Path (Split-Path -Parent $candidate) 'javaw.exe'
    if ((Test-Path -LiteralPath $candidate) -and (Test-Path -LiteralPath $gui) -and (Get-JavaMajor $candidate) -ge 21) {
        $java = (Resolve-Path -LiteralPath $gui).Path
        break
    }
}
if (-not $java) { throw '没有找到 Java 21 或更新版本。请安装后设置 JAVA_HOME，或使用 -JavaHome 指定目录。' }
$cache = Join-Path $PSScriptRoot '.tools/javafx-cache'
$arguments = @("-Djavafx.cachedir=$cache", '-jar', $jar, '--profile', $Profile)
if ($Image) { $arguments += @('--image', $Image) }
if ($Directory) { $arguments += @('--directory', $Directory) }
if ($Check) {
    Write-Output "Java: $java"
    Write-Output "Application: $jar"
    return
}
$null = New-Item -ItemType Directory -Path $cache -Force
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$errorLog = Join-Path $PSScriptRoot ".tools/desktop-$stamp-stderr.log"
$outputLog = Join-Path $PSScriptRoot ".tools/desktop-$stamp-stdout.log"
# Start-Process joins arguments on Windows: quote paths, including trailing backslashes.
$quoted = $arguments | ForEach-Object { '"' + ($_ -replace '(\\+)$', '$1$1') + '"' }
$process = Start-Process -FilePath $java -ArgumentList $quoted -WorkingDirectory $PSScriptRoot -WindowStyle Normal -RedirectStandardError $errorLog -RedirectStandardOutput $outputLog -PassThru
if ($process.WaitForExit(1500) -and $process.ExitCode -ne 0) {
    throw "窗口启动失败，错误记录：$errorLog"
}
