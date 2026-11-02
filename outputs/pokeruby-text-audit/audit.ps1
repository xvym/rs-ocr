$ErrorActionPreference = 'Stop'
$inputRoot = Join-Path $PSScriptRoot 'inputs'
$summaries = @()
foreach ($game in @('ruby','sapphire')) {
    $gameChinese = if ($game -eq 'ruby') { '红宝石' } else { '蓝宝石' }
    $translationPath = Join-Path $inputRoot ($gameChinese + '1.2汉化总文本(JP).txt')
    $translation = [IO.File]::ReadAllText($translationPath)
    $entries = [regex]::Matches($translation, '(?s)地址=(0x[0-9A-Fa-f]+)\s+字节数=(\d+)\s+文本=(.*?)\r?\n[ \t]*\}')
    $symbolsByAddress = @{}
    $symbols = [Collections.Generic.List[object]]::new()
    foreach ($line in [IO.File]::ReadLines((Join-Path $inputRoot ("poke${game}_rev2.sym")))) {
        if ($line -match '^([0-9a-fA-F]{8})\s+(\S)\s+([0-9a-fA-F]{8})\s+(\S+)\s*$') {
            $address = [Convert]::ToInt32($Matches[1],16)
            if ($address -lt 0x08000000 -or $address -ge 0x0A000000) { continue }
            $symbol = [pscustomobject]@{ Offset=($address - 0x08000000); Size=[Convert]::ToInt32($Matches[3],16); Name=$Matches[4] }
            $symbols.Add($symbol)
            if (-not $symbolsByAddress.ContainsKey($symbol.Offset)) { $symbolsByAddress[$symbol.Offset] = [Collections.Generic.List[object]]::new() }
            $symbolsByAddress[$symbol.Offset].Add($symbol)
        }
    }
    $sortedOffsets = [int[]]@($symbolsByAddress.Keys | Sort-Object)
    $rows = foreach ($entry in $entries) {
        $offset = [Convert]::ToInt32($entry.Groups[1].Value.Substring(2),16)
        $byteCount = [int]$entry.Groups[2].Value
        $exact = $symbolsByAddress[$offset]
        $index = [Array]::BinarySearch($sortedOffsets,$offset)
        $previousIndex = if ($index -ge 0) { $index } else { (-bnot $index) - 1 }
        $previousOffset = if ($previousIndex -ge 0) { $sortedOffsets[$previousIndex] } else { $null }
        $nextIndex = $previousIndex + 1
        $nextOffset = if ($nextIndex -lt $sortedOffsets.Count) { $sortedOffsets[$nextIndex] } else { $null }
        $previous = if ($null -ne $previousOffset) { $symbolsByAddress[$previousOffset] } else { @() }
        $sizedExact = @($exact | Where-Object { $_.Size -gt 0 })
        $sizedPrevious = @($previous | Where-Object { $_.Size -gt 0 -and $offset -lt ($_.Offset + $_.Size) })
        [pscustomobject]@{
            Game=$game; Offset=('0x{0:X6}' -f $offset); ByteCount=$byteCount
            ExactSymbol=(@($exact | ForEach-Object Name) -join '|')
            SymbolSizes=(@($sizedExact | ForEach-Object Size) -join '|')
            ExactSizeMinusTerminatorMatch=(@($sizedExact | Where-Object { $_.Size -eq ($byteCount+1) }).Count -gt 0)
            PreviousSymbol=(@($previous | ForEach-Object Name) -join '|')
            DeltaFromPrevious=if ($null -ne $previousOffset) { $offset - $previousOffset } else { '' }
            WithinSizedSymbol=(@($sizedPrevious | ForEach-Object Name) -join '|')
            BytesUntilNextSymbol=if ($null -ne $nextOffset) { $nextOffset - $offset } else { '' }
            Chinese=$entry.Groups[3].Value.TrimEnd("`r")
        }
    }
    $rows | Export-Csv -LiteralPath (Join-Path $PSScriptRoot "$game-address-audit.csv") -NoTypeInformation -Encoding utf8
    $summary = [pscustomobject]@{
        Game=$game; Entries=$rows.Count
        ExactSymbol=@($rows | Where-Object ExactSymbol).Count
        NoExactSymbol=@($rows | Where-Object { -not $_.ExactSymbol }).Count
        ExactSizeMinusTerminatorMatch=@($rows | Where-Object ExactSizeMinusTerminatorMatch).Count
        NonExactInsideSizedSymbol=@($rows | Where-Object { -not $_.ExactSymbol -and $_.WithinSizedSymbol }).Count
    }
    $summaries += $summary
    $summary | Format-List
    $rows | Where-Object { -not $_.ExactSymbol } | Select-Object -First 12 Offset,ByteCount,PreviousSymbol,DeltaFromPrevious,WithinSizedSymbol,BytesUntilNextSymbol | Format-Table -AutoSize
}
$summaries | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'summary.json') -Encoding utf8
