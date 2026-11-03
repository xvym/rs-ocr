param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$ToolsRoot = (Join-Path $PSScriptRoot '../g1-ocr/.tools/native')
)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome -or -not (Test-Path -LiteralPath "$JavaHome/include/jni.h")) {
    throw '请用 -JavaHome 指定 JDK 21。'
}
$compilerRoot = Join-Path $ToolsRoot 'vs/VC/Tools/MSVC/14.44.35207'
$sdkRoot = Join-Path $ToolsRoot 'microsoft.windows.sdk.cpp/c'
$sdkLibraries = Join-Path $ToolsRoot 'microsoft.windows.sdk.cpp.x64/c'
$cmakeRoot = Join-Path $ToolsRoot 'vs/Common7/IDE/CommonExtensions/Microsoft/CMake'
$oldEnvironment = @{}
foreach ($name in @('JAVA_HOME','PATH','INCLUDE','LIB')) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = $JavaHome
    $env:PATH = "$compilerRoot/bin/Hostx64/x64;$sdkRoot/bin/10.0.26100.0/x64;$cmakeRoot/Ninja;$env:PATH"
    $env:INCLUDE = "$compilerRoot/include;$sdkRoot/Include/10.0.26100.0/ucrt;$sdkRoot/Include/10.0.26100.0/shared;$sdkRoot/Include/10.0.26100.0/um;$sdkRoot/Include/10.0.26100.0/winrt;$sdkRoot/Include/10.0.26100.0/cppwinrt"
    $env:LIB = "$compilerRoot/lib/x64;$compilerRoot/lib/onecore/x64;$sdkLibraries/um/x64;$sdkLibraries/ucrt/x64"
    $cmake = Join-Path $cmakeRoot 'CMake/bin/cmake.exe'
    & $cmake -S native/capture -B .tools/capture -G 'Ninja Multi-Config' '-DCMAKE_CXX_COMPILER=cl'
    if ($LASTEXITCODE -ne 0) { throw '捕获组件配置失败。' }
    & $cmake --build .tools/capture --config Release
    if ($LASTEXITCODE -ne 0) { throw '捕获组件构建失败。' }
    $destination = 'desktop/target/generated-resources/native/windows-x64'
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -LiteralPath '.tools/capture/Release/rscapture.dll' -Destination "$destination/rscapture.dll"
} finally {
    Pop-Location
    foreach ($name in $oldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process') }
}
