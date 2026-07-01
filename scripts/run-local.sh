#!/usr/bin/env bash
# TryCue 本地开发一键启动脚本（macOS / Linux）
#
# 用法：
#   ./scripts/run-local.sh           安装依赖 + 迁移 + 启动
#   ./scripts/run-local.sh --seed    额外写入 demo 种子数据
#   ./scripts/run-local.sh --skip-install  跳过依赖安装

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SEED_DEMO=false
SKIP_INSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed)
      SEED_DEMO=true
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--seed] [--skip-install]"
      exit 1
      ;;
  esac
done

# 检查 pnpm 是否可用
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Installing via corepack..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10.4.0 --activate
  else
    echo "corepack not found. Please install Node.js 24+ or run: npm install -g pnpm@10.4.0"
    exit 1
  fi
fi

# 确保 .env.local 存在
if [ ! -f ".env.local" ]; then
  echo "Creating .env.local from .env.example..."
  cp .env.example .env.local
fi

# 确保 config/llm.local.yaml 存在（默认 mock 模式，无需真实 key）
if [ ! -f "config/llm.local.yaml" ]; then
  echo "Creating config/llm.local.yaml from config/llm.example.yaml..."
  cp config/llm.example.yaml config/llm.local.yaml
fi

# 安装依赖
if [ "$SKIP_INSTALL" = false ] && [ ! -d "node_modules" ]; then
  echo "Installing workspace dependencies..."
  pnpm install
fi

echo "Generating Prisma client..."
pnpm db:generate

echo "Applying database migrations..."
pnpm db:deploy

if [ "$SEED_DEMO" = true ]; then
  echo "Seeding demo data..."
  pnpm db:seed-demo
fi

echo ""
echo "Starting TryCue:"
echo "  - Web: http://localhost:3000"
echo "  - API: http://localhost:4000"
echo ""
exec pnpm dev
