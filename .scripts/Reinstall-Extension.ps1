#Requires -Version 5.1
<#
.SYNOPSIS
  Build, package, install, and reload the extension into the running
  VS Code window. The full local iteration loop in one command.

.DESCRIPTION
  Wipes any stale .vsix files in the repo root so the install always
  picks the freshly built one (a recurring source of "wait, why am I
  testing the old version" confusion). Then runs esbuild, vsce
  package, code --install-extension --force, and reloads the window.

  Invoked via `npm run reinstall` so it stays portable to wherever
  the npm scripts are documented.

.PARAMETER SkipBuild
  Use the existing dist/extension.js instead of rebuilding. Useful
  when iterating on a hot-rebuild loop in another terminal.

.EXAMPLE
  npm run reinstall

.EXAMPLE
  npm run reinstall -- --SkipBuild
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $repoRoot
try {
    Write-Host '==> Wiping stale .vsix files…' -ForegroundColor Cyan
    Get-ChildItem -Filter '*.vsix' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "    removing $($_.Name)"
        Remove-Item $_.FullName -Force
    }

    if (-not $SkipBuild) {
        Write-Host '==> Bundling with esbuild…' -ForegroundColor Cyan
        node esbuild.config.mjs
        if ($LASTEXITCODE -ne 0) { throw 'esbuild bundle failed' }
    } else {
        Write-Host '==> Skipping build (--SkipBuild)' -ForegroundColor Yellow
    }

    Write-Host '==> Packaging .vsix…' -ForegroundColor Cyan
    npx --yes @vscode/vsce package --no-yarn
    if ($LASTEXITCODE -ne 0) { throw 'vsce package failed' }

    $vsix = Get-ChildItem -Filter 'youtrack-companion-*.vsix' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $vsix) { throw 'No .vsix found after packaging.' }

    Write-Host "==> Installing $($vsix.Name)…" -ForegroundColor Cyan
    code --install-extension $vsix.FullName --force
    if ($LASTEXITCODE -ne 0) { throw 'code --install-extension failed' }

    Write-Host '==> Reloading VS Code window…' -ForegroundColor Cyan
    code --command 'workbench.action.reloadWindow'

    Write-Host "Done. Installed $($vsix.Name) and reloaded the window." -ForegroundColor Green
}
finally {
    Pop-Location
}
