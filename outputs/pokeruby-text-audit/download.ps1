$ErrorActionPreference = 'Stop'
$auditRoot = $PSScriptRoot
$inputRoot = Join-Path $auditRoot 'inputs'
New-Item -ItemType Directory -Path $inputRoot -Force | Out-Null
$sources = @(
    @{ Owner='pret'; Repo='pokeruby'; Branch='symbols'; Files=@('pokeruby_rev2.sym','pokesapphire_rev2.sym','pokeruby.sym','pokesapphire.sym') },
    @{ Owner='UWorldGX'; Repo='pkmn_rs_chn_rsc'; Branch='main'; Files=@(
        '1.2汉化红宝石拼合/红宝石1.2汉化总文本(JP).txt',
        '1.2汉化蓝宝石拼合/蓝宝石1.2汉化总文本(JP).txt'
    ) }
)
$manifest = @()
foreach ($source in $sources) {
    $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$($source.Owner)/$($source.Repo)/commits/$($source.Branch)" -MaximumRetryCount 3 -RetryIntervalSec 2
    foreach ($file in $source.Files) {
        $encodedPath = ($file.Split('/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
        $url = "https://raw.githubusercontent.com/$($source.Owner)/$($source.Repo)/$($commit.sha)/$encodedPath"
        $destination = Join-Path $inputRoot ([IO.Path]::GetFileName($file))
        Invoke-WebRequest -Uri $url -OutFile $destination -MaximumRetryCount 3 -RetryIntervalSec 2
        $manifest += [pscustomobject]@{ Repository="$($source.Owner)/$($source.Repo)"; Branch=$source.Branch; Commit=$commit.sha; CommitDate=$commit.commit.committer.date; Path=$file; LocalFile=[IO.Path]::GetFileName($file); Url=$url; SHA256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash }
    }
}
$sourceCommit = Invoke-RestMethod -Uri 'https://api.github.com/repos/pret/pokeruby/commits/master' -MaximumRetryCount 3 -RetryIntervalSec 2
$archivePath = Join-Path $inputRoot 'pokeruby-source.zip'
Invoke-WebRequest -Uri "https://codeload.github.com/pret/pokeruby/zip/$($sourceCommit.sha)" -OutFile $archivePath -MaximumRetryCount 3 -RetryIntervalSec 2
$manifest += [pscustomobject]@{ Repository='pret/pokeruby'; Branch='master'; Commit=$sourceCommit.sha; CommitDate=$sourceCommit.commit.committer.date; Path='source archive'; LocalFile='pokeruby-source.zip'; Url="https://codeload.github.com/pret/pokeruby/zip/$($sourceCommit.sha)"; SHA256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash }
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $auditRoot 'manifest.json') -Encoding utf8
$manifest | Select-Object Repository,Branch,Commit,LocalFile | Format-Table -AutoSize
