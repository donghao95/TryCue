param(
  [switch]$SkipInstall,
  [switch]$SeedDemo
)

$ErrorActionPreference = "Stop"

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
  }
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if (-not (Test-Path ".env.local")) {
  Write-Host "Creating .env.local from .env.example..."
  Copy-Item ".env.example" ".env.local"
}

if (-not $SkipInstall -and -not (Test-Path "node_modules")) {
  Write-Host "Installing workspace dependencies..."
  Invoke-Native "pnpm" "install"
}

Write-Host "Generating Prisma client..."
Invoke-Native "pnpm" "db:generate"

Write-Host "Applying database migrations..."
Invoke-Native "pnpm" "db:deploy"

if ($SeedDemo) {
  Write-Host "Seeding demo data..."
  Invoke-Native "pnpm" "db:seed-demo"
}

Write-Host ""
Write-Host "Starting TryCue:"
Write-Host "- Web: http://localhost:3000"
Write-Host "- API: http://localhost:4000"
Write-Host ""
Invoke-Native "pnpm" "dev"
