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

# 检查 pnpm 是否可用
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "pnpm not found. Installing via corepack..."
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable
    corepack prepare pnpm@10.4.0 --activate
  } else {
    throw "corepack not found. Please install Node.js 24+ or run: npm install -g pnpm@10.4.0"
  }
}

# 确保 .env.local 存在
if (-not (Test-Path ".env.local")) {
  Write-Host "Creating .env.local from .env.example..."
  Copy-Item ".env.example" ".env.local"
}

# 确保 config/llm.local.yaml 存在（默认 mock 模式，无需真实 key）
if (-not (Test-Path "config/llm.local.yaml")) {
  Write-Host "Creating config/llm.local.yaml from config/llm.example.yaml..."
  Copy-Item "config/llm.example.yaml" "config/llm.local.yaml"
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
