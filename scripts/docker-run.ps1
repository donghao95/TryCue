<#
.SYNOPSIS
  TryCue Docker 一键启动脚本（Windows / PowerShell）

.DESCRIPTION
  拉取 GHCR 镜像并启动容器。首次启动会自动创建数据目录和配置模板。
  mock 模式开箱即用，无需 LLM Key。

.PARAMETER Tag
  镜像版本，默认 latest

.PARAMETER Port
  宿主机端口，默认 4000

.EXAMPLE
  .\scripts\docker-run.ps1
  .\scripts\docker-run.ps1 -Tag v0.2.0 -Port 8080
#>
param(
  [string]$Tag = "latest",
  [int]$Port = 4000
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

# 确保数据目录存在
$dataDir = Join-Path $RepoRoot "data"
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

# 确保配置目录存在
$configDir = Join-Path $RepoRoot "config"
if (-not (Test-Path $configDir)) {
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

# 确保 LLM 配置模板存在
$llmConfig = Join-Path $configDir "llm.local.yaml"
if (-not (Test-Path $llmConfig)) {
  Write-Host "Creating config/llm.local.yaml from template (mock mode)..."
  Copy-Item "config/llm.example.yaml" $llmConfig
}

$image = "ghcr.io/donghao95/trycue:$Tag"

Write-Host "Pulling image: $image"
docker pull $image

Write-Host ""
Write-Host "Starting TryCue container:"
Write-Host "  - URL:   http://localhost:$Port"
Write-Host "  - Data:  $dataDir"
Write-Host "  - Config: $llmConfig"
Write-Host "  - Mode:  mock (edit llm.local.yaml to switch to real)"
Write-Host ""

# 如果已有同名容器在运行，先停止
docker rm -f trycue 2>$null | Out-Null

# uploads 默认不挂载：用镜像内 baked 的 demo 图片。
# 如需持久化用户上传图片，需先从镜像拷出 demo 图片到 ./uploads，再在下方 docker run 加：
#   -v "${RepoRoot}/uploads:/app/apps/api/uploads"
# 拷出命令：docker run --rm --entrypoint sh ghcr.io/donghao95/trycue:$Tag -c "tar -C /app/apps/api/uploads -cf - ." | tar -C ./uploads -xf -
docker run -d `
  --name trycue `
  -p "${Port}:4000" `
  -v "${dataDir}:/app/data" `
  -v "${configDir}:/app/config" `
  -e APP_URL="http://localhost:$Port" `
  -e LOG_LEVEL=info `
  --restart unless-stopped `
  $image

Write-Host ""
Write-Host "Container started. Waiting for health check..."
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $health = docker inspect --format='{{.State.Health.Status}}' trycue 2>$null
  if ($health -eq "healthy") {
    Write-Host "TryCue is healthy! Open http://localhost:$Port"
    exit 0
  }
  Write-Host "  ...waiting ($($i*2+2)s)"
}
Write-Host "Container did not become healthy in 60s. Check logs: docker logs trycue"
exit 1
