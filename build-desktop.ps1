param([string]$JavaHome = $env:JAVA_HOME, [string]$Maven = 'mvn', [string]$MavenRepository, [switch]$Offline)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath "$PSScriptRoot/target/rs-ocr-0.1.0.jar")) { throw '请先通过 build.ps1 构建离线识别程序。' }
if (-not $JavaHome -or -not (Test-Path -LiteralPath "$JavaHome/bin/javac.exe")) { throw '请通过 -JavaHome 指定 JDK 21 或更高版本。' }
$previousJavaHome = $env:JAVA_HOME
Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = $JavaHome
    & node "$PSScriptRoot/tools/build_s7_resources.mjs"
    if ($LASTEXITCODE -ne 0) { throw '原汉化桌面资源构建失败。' }
    & "$PSScriptRoot/build-capture.ps1" -JavaHome $JavaHome
    $arguments = @('-f', 'desktop/pom.xml', '-s', 'tools/maven-settings.xml', 'package')
    if ($Offline) { $arguments += '-o' }
    if ($MavenRepository) { $arguments += "-Dmaven.repo.local=$MavenRepository" }
    & $Maven @arguments
    if ($LASTEXITCODE -ne 0) { throw '桌面窗口构建或检查失败。' }
    Write-Host '桌面窗口已构建：desktop/target/rs-ocr-desktop-0.1.0.jar'
} finally { $env:JAVA_HOME = $previousJavaHome; Pop-Location }
