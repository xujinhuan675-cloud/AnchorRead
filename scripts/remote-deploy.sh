#!/usr/bin/env bash
# AnchorRead 远端蓝绿部署脚本（在生产服务器上执行）
#
# 职责：从镜像仓库拉取「已构建好的」镜像 → 蓝绿切换 → 健康检查 → 失败自动回滚。
# 构建不在此发生：镜像由 GitHub Actions 构建并推送到 GHCR，本脚本只负责「取镜像 + 切换」，
# 因此不再与常驻容器争抢构建期的 CPU/内存/IO。
#
# 由 CI（.github/workflows/deploy.yml）通过 SSH 调用；所有配置以环境变量传入。
# GHCR 拉取凭证只从服务器本地 .env 读取（GHCR_USER / GHCR_PAT），不经 CI 传递、不落日志。
#
# 必需环境变量：
#   IMAGE_REF        完整镜像引用，如 ghcr.io/<owner>/anchorread:<sha>
# 可选环境变量（默认值与现有部署一致）：
#   REMOTE_DIR       服务器项目目录，存放 .env（默认 /opt/anchorread）
#   CONTAINER        线上容器名（默认 anchorread）
#   DATA_VOLUME      数据卷名（默认 anchorread-data）
#   HOST_PORT        线上本机端口（默认 3001）
#   CANDIDATE_PORT   候选本机端口（默认 3002，需不同于 HOST_PORT）
#   PUBLIC_URL       线上地址（默认 https://anchorread.flowguide.cc）
#   DOCKER_NETWORK   可选 Docker 网络；启用 Redis/多实例时应加入与 Redis 相同的网络
#   SHORT_COMMIT     短提交，用于 SENTRY_RELEASE 与候选/回滚容器命名（默认 latest）
#   COMMIT           完整提交，仅用于结果记录（默认取 SHORT_COMMIT）

# 与既有部署脚本保持一致的严格度：set -eu（不启用 pipefail，避免 grep 无匹配等既有管线行为变化）
set -eu

: "${IMAGE_REF:?IMAGE_REF is required}"
REMOTE_DIR="${REMOTE_DIR:-/opt/anchorread}"
CONTAINER="${CONTAINER:-anchorread}"
DATA_VOLUME="${DATA_VOLUME:-anchorread-data}"
HOST_PORT="${HOST_PORT:-3001}"
CANDIDATE_PORT="${CANDIDATE_PORT:-3002}"
PUBLIC_URL="${PUBLIC_URL:-https://anchorread.flowguide.cc}"
DOCKER_NETWORK="${DOCKER_NETWORK:-}"
SHORT_COMMIT="${SHORT_COMMIT:-latest}"
COMMIT="${COMMIT:-$SHORT_COMMIT}"

if [ "$CANDIDATE_PORT" = "$HOST_PORT" ]; then
  echo "CANDIDATE_PORT must differ from HOST_PORT" >&2
  exit 2
fi

cd "$REMOTE_DIR"

old_container="$CONTAINER"
candidate_container="${CONTAINER}-candidate-${SHORT_COMMIT}"
rollback_container="${CONTAINER}-rollback-${SHORT_COMMIT}"

env_file="$(mktemp)"
runtime_env_file="$(mktemp)"
cleanup() {
  docker rm -f "$candidate_container" >/dev/null 2>&1 || true
  rm -f "$env_file" "$runtime_env_file"
}
trap cleanup EXIT

# 运行时环境 = 旧容器环境 + 服务器 .env（后者为面向未来部署的持久覆盖）
if docker inspect "$old_container" >/dev/null 2>&1; then
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$old_container" > "$env_file"
else
  : > "$env_file"
fi
if [ -f .env ]; then
  cat .env >> "$env_file"
fi

# 构建/拉取凭证不得进入运行容器：剥离 Sentry 构建凭证与 GHCR 拉取凭证
awk -F= '$1 != "SENTRY_AUTH_TOKEN" && $1 != "SENTRY_ORG" && $1 != "SENTRY_PROJECT" && $1 != "GHCR_USER" && $1 != "GHCR_PAT"' "$env_file" > "$runtime_env_file"

env_value() {
  key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' "$env_file"
}

if [ -z "$DOCKER_NETWORK" ]; then
  DOCKER_NETWORK="$(env_value DOCKER_NETWORK)"
fi

diagram_broker="$(env_value ANCHORREAD_DIAGRAM_BROKER)"
if [ "$diagram_broker" = "redis" ] && [ -z "$(env_value ANCHORREAD_REDIS_URL)" ]; then
  echo "ANCHORREAD_REDIS_URL is required when ANCHORREAD_DIAGRAM_BROKER=redis" >&2
  exit 2
fi

docker_network_args=()
if [ -n "$DOCKER_NETWORK" ]; then
  docker_network_args=(--network "$DOCKER_NETWORK")
fi

# 登录 GHCR 并拉取目标镜像（凭证仅存在于服务器本地 .env）
ghcr_user="$(env_value GHCR_USER)"
ghcr_pat="$(env_value GHCR_PAT)"
if [ -n "$ghcr_pat" ]; then
  printf '%s' "$ghcr_pat" | docker login ghcr.io -u "${ghcr_user:-anchorread}" --password-stdin >/dev/null
fi
docker pull "$IMAGE_REF"

docker volume create "$DATA_VOLUME" >/dev/null

check_url() {
  url="$1"
  attempt=1
  while [ "$attempt" -le 20 ]; do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

# 候选容器：临时端口起新镜像并做本机健康检查，通过后才切换线上
docker rm -f "$candidate_container" >/dev/null 2>&1 || true
docker run -d --name "$candidate_container" "${docker_network_args[@]}" --env-file "$runtime_env_file" --env "ANCHORREAD_PUBLIC_URL=$PUBLIC_URL" --env "SENTRY_RELEASE=anchor-read@$SHORT_COMMIT" --mount type=volume,src="$DATA_VOLUME",dst=/data --restart no -p "127.0.0.1:${CANDIDATE_PORT}:3000" "$IMAGE_REF" >/dev/null
check_url "http://127.0.0.1:${CANDIDATE_PORT}/"
docker rm -f "$candidate_container" >/dev/null

# 清理历史遗留的回滚容器
docker ps -a --format '{{.Names}}' | grep "^${CONTAINER}-rollback-" | while read -r stale; do
  docker rm -f "$stale" >/dev/null
done || true

# 旧容器停服并改名为回滚容器，保留一键回退能力
if docker inspect "$old_container" >/dev/null 2>&1; then
  docker stop "$old_container" >/dev/null
  docker rename "$old_container" "$rollback_container"
fi

restore_rollback() {
  docker rm -f "$old_container" >/dev/null 2>&1 || true
  if docker inspect "$rollback_container" >/dev/null 2>&1; then
    docker rename "$rollback_container" "$old_container"
    docker start "$old_container" >/dev/null
  fi
}

# 启动新线上容器；起不来或健康检查不过则自动回滚
if ! docker run -d --name "$old_container" "${docker_network_args[@]}" --env-file "$runtime_env_file" --env "ANCHORREAD_PUBLIC_URL=$PUBLIC_URL" --env "SENTRY_RELEASE=anchor-read@$SHORT_COMMIT" --mount type=volume,src="$DATA_VOLUME",dst=/data --restart unless-stopped -p "127.0.0.1:${HOST_PORT}:3000" "$IMAGE_REF" >/dev/null; then
  restore_rollback
  exit 1
fi

if ! check_url "http://127.0.0.1:${HOST_PORT}/"; then
  restore_rollback
  exit 1
fi

docker inspect "$old_container" --format "deployed_image={{.Config.Image}} status={{.State.Status}} commit=${COMMIT}"
