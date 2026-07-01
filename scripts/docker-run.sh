#!/usr/bin/env bash
# TryCue Docker 一键启动脚本（macOS / Linux）
#
# 用法：
#   ./scripts/docker-run.sh                 最新版，端口 2671
#   ./scripts/docker-run.sh --tag v0.2.0    指定版本
#   ./scripts/docker-run.sh --port 8080     指定端口
#
# 首次启动会自动创建 ./data、./config/llm.local.yaml、./uploads 目录。
# mock 模式开箱即用，无需 LLM Key。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TAG="latest"
PORT=2671

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--tag <tag>] [--port <port>]"
      exit 1
      ;;
  esac
done

# 检查 docker
if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Please install Docker Desktop or Docker Engine."
  exit 1
fi

# 确保数据目录存在
mkdir -p "$REPO_ROOT/data"
mkdir -p "$REPO_ROOT/config"

# 确保 LLM 配置模板存在
LLM_CONFIG="$REPO_ROOT/config/llm.local.yaml"
if [ ! -f "$LLM_CONFIG" ]; then
  echo "Creating config/llm.local.yaml from template (mock mode)..."
  cp config/llm.example.yaml "$LLM_CONFIG"
fi

IMAGE="ghcr.io/donghao95/trycue:$TAG"

echo "Pulling image: $IMAGE"
docker pull "$IMAGE"

echo ""
echo "Starting TryCue container:"
echo "  - URL:    http://localhost:$PORT"
echo "  - Data:   $REPO_ROOT/data"
echo "  - Config: $LLM_CONFIG"
echo "  - Mode:   mock (edit llm.local.yaml to switch to real)"
echo ""

# 如果已有同名容器在运行，先停止
docker rm -f trycue 2>/dev/null || true

# uploads 默认不挂载：用镜像内 baked 的 demo 图片。
# 如需持久化用户上传图片，需先从镜像拷出 demo 图片到 ./uploads，再在下方 docker run 加：
#   -v "$REPO_ROOT/uploads:/app/apps/api/uploads"
# 拷出命令：docker run --rm --entrypoint sh "$IMAGE" -c "tar -C /app/apps/api/uploads -cf - ." | tar -C ./uploads -xf -
docker run -d \
  --name trycue \
  -p "${PORT}:2671" \
  -v "$REPO_ROOT/data:/app/data" \
  -v "$REPO_ROOT/config:/app/config" \
  -e APP_URL="http://localhost:$PORT" \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  "$IMAGE"

echo ""
echo "Container started. Waiting for health check..."
for i in $(seq 1 30); do
  sleep 2
  health=$(docker inspect --format='{{.State.Health.Status}}' trycue 2>/dev/null || echo "none")
  if [ "$health" = "healthy" ]; then
    echo "TryCue is healthy! Open http://localhost:$PORT"
    exit 0
  fi
  echo "  ...waiting ($((i*2))s)"
done
echo "Container did not become healthy in 60s. Check logs: docker logs trycue"
exit 1
