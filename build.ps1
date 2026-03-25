# Build script for Kustomize Navigator extension
# Run from repo root: .\build.ps1
# Steps: install (if needed), type-check, production webpack bundle, package (.vsix to ./output)

$ErrorActionPreference = "Stop"
if ($PSScriptRoot) { Set-Location $PSScriptRoot }

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm install
}

Write-Host "Type-checking..."
npm run check-types
if ($LASTEXITCODE -ne 0) { throw "Type-check failed" }

Write-Host "Building (production bundle)..."
npm run package
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

Write-Host "Packaging extension..."
npx vsce package --out ./output
if ($LASTEXITCODE -ne 0) { throw "Package failed" }

Write-Host "Done. .vsix file created in ./output"
