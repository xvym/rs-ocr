param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$Maven = 'mvn',
    [string]$MavenRepository,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$previousJavaHome = $env:JAVA_HOME
try {
    if (-not $JavaHome -and (Test-Path -LiteralPath "$PSScriptRoot/.tools/jdk/bin/java.exe")) {
        $JavaHome = "$PSScriptRoot/.tools/jdk"
    }
    if (-not $JavaHome -or -not (Test-Path -LiteralPath "$JavaHome/bin/javac.exe")) {
        throw '构建需要 JDK 21 或更高版本。请设置 JAVA_HOME，或通过 -JavaHome 指定目录。'
    }
    $javaVersion = & "$JavaHome/bin/javac.exe" -version 2>&1
    if ("$javaVersion" -notmatch 'javac (\d+)' -or [int]$Matches[1] -lt 21) {
        throw "构建需要 JDK 21 或更高版本；当前为 $javaVersion。"
    }
    $env:JAVA_HOME = $JavaHome
    $arguments = @('-s', 'tools/maven-settings.xml', 'package')
    if ($Offline) { $arguments += '-o' }
    if ($MavenRepository) { $arguments += "-Dmaven.repo.local=$MavenRepository" }
    & $Maven @arguments
    if ($LASTEXITCODE -ne 0) { throw '构建或回归检查失败。' }
    Write-Host '构建完成：target/rs-ocr-0.1.0.jar'
} finally {
    $env:JAVA_HOME = $previousJavaHome
    Pop-Location
}
