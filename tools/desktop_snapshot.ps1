function Get-DesktopSnapshot([string]$SourceJar, [string]$CacheRoot) {
    $hash = (Get-FileHash -LiteralPath $SourceJar -Algorithm SHA256).Hash.ToLowerInvariant()
    $directory = Join-Path $CacheRoot $hash
    $snapshot = Join-Path $directory 'rs-ocr-desktop-0.1.0.jar'
    $null = New-Item -ItemType Directory -Path $directory -Force
    if (-not (Test-Path -LiteralPath $snapshot)) {
        $temporary = Join-Path $directory ([Guid]::NewGuid().ToString('N') + '.tmp')
        try {
            Copy-Item -LiteralPath $SourceJar -Destination $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
                throw '程序正在更新，请稍后重新启动。'
            }
            try { [System.IO.File]::Move($temporary, $snapshot) }
            catch { if (-not (Test-Path -LiteralPath $snapshot)) { throw } }
        } finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        }
    }
    if ((Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
        throw '启动副本校验失败，请清理对应的 .tools/desktop-cache 子目录后重新启动。'
    }
    return $snapshot
}
