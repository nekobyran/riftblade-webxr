[CmdletBinding()]
param(
    [ValidateSet('Install', 'Test', 'Build', 'Check', 'Dev', 'Preview', 'CleanCache')]
    [string]$Action = 'Check',
    [string]$SdkRoot = 'D:\vibecoding\sdk\riftblade-webxr',
    [string]$ReleaseRoot = 'D:\vibecoding\release\riftblade-webxr',
    [int]$Port = 4173
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeModules = Join-Path $SdkRoot 'node_modules'
$ProjectNodeModules = Join-Path $ProjectRoot 'node_modules'
$NpmCache = 'D:\vibecoding\sdk\cache\npm'
$Dist = Join-Path $ReleaseRoot 'dist'

function Assert-DiskBudget {
    $c = Get-PSDrive C
    $d = Get-PSDrive D
    if ($c.Free -lt 20GB) { throw 'C: free space is below the required 20 GiB safety floor.' }
    if ($d.Free -lt 100GB) { throw 'D: free space is below the required 100 GiB safety floor.' }
}

function Install-Dependencies {
    Assert-DiskBudget
    New-Item -ItemType Directory -Force -Path $SdkRoot, $NpmCache | Out-Null
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json') -Destination (Join-Path $SdkRoot 'package.json') -Force
    Push-Location $SdkRoot
    try {
        & npm install --cache $NpmCache --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Copy-Item -LiteralPath (Join-Path $SdkRoot 'package-lock.json') -Destination (Join-Path $ProjectRoot 'package-lock.json') -Force

    if (Test-Path -LiteralPath $ProjectNodeModules) {
        $item = Get-Item -LiteralPath $ProjectNodeModules -Force
        if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to replace non-junction path: $ProjectNodeModules"
        }
        Remove-Item -LiteralPath $ProjectNodeModules -Force
    }
    New-Item -ItemType Junction -Path $ProjectNodeModules -Target $NodeModules | Out-Null
}

function Ensure-Dependencies {
    if (-not (Test-Path -LiteralPath (Join-Path $NodeModules 'vite'))) {
        Install-Dependencies
    } elseif (-not (Test-Path -LiteralPath $ProjectNodeModules)) {
        New-Item -ItemType Junction -Path $ProjectNodeModules -Target $NodeModules | Out-Null
    }
}

function Invoke-Npm {
    param([Parameter(Mandatory)][string[]]$Arguments)
    Push-Location $ProjectRoot
    try {
        & npm @Arguments
        if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

switch ($Action) {
    'Install' { Install-Dependencies }
    'Test' {
        Ensure-Dependencies
        Invoke-Npm @('test')
    }
    'Build' {
        Ensure-Dependencies
        Assert-DiskBudget
        New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
        $env:RIFTBLADE_OUT_DIR = $Dist
        try { Invoke-Npm @('run', 'build') } finally { Remove-Item Env:RIFTBLADE_OUT_DIR -ErrorAction SilentlyContinue }
        Write-Host "artifact: $Dist"
    }
    'Check' {
        Ensure-Dependencies
        Invoke-Npm @('test')
        Assert-DiskBudget
        New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
        $env:RIFTBLADE_OUT_DIR = $Dist
        try { Invoke-Npm @('run', 'build') } finally { Remove-Item Env:RIFTBLADE_OUT_DIR -ErrorAction SilentlyContinue }
        Write-Host "artifact: $Dist"
    }
    'Dev' {
        Ensure-Dependencies
        Invoke-Npm @('run', 'dev', '--', '--port', "$Port")
    }
    'Preview' {
        Ensure-Dependencies
        if (-not (Test-Path -LiteralPath (Join-Path $Dist 'index.html'))) { throw "Build first: $Dist" }
        $env:RIFTBLADE_OUT_DIR = $Dist
        try { Invoke-Npm @('run', 'preview', '--', '--port', "$Port") } finally { Remove-Item Env:RIFTBLADE_OUT_DIR -ErrorAction SilentlyContinue }
    }
    'CleanCache' {
        $viteCache = Join-Path $NodeModules '.vite'
        if (Test-Path -LiteralPath $viteCache) { Remove-Item -LiteralPath $viteCache -Recurse -Force }
        Write-Host 'Vite cache cleaned.'
    }
}
