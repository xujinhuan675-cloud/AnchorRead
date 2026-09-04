[CmdletBinding()]
param(
  [string]$SshTarget = 'lcayun-1panel',
  [string]$RemoteDir = '/opt/anchorread',
  [string]$Branch = 'main',
  [string]$ContainerName = 'anchorread',
  [string]$ImageRepository = 'anchorread',
  [string]$DataVolume = 'anchorread-data',
  [int]$HostPort = 3001,
  [int]$CandidatePort = 3002,
  [string]$HealthUrl = 'https://anchorread.flowguide.cc/',
  [switch]$Push,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = 'Stop'

# 原生命令（git/ssh/docker）的 stderr 进度输出不是错误：Stop 偏好会把 stderr
# 错误记录升级为 NativeCommandError 并终止语句，必须以退出码为准。
function Invoke-NativeCapture {
  param([Parameter(Mandatory)] [scriptblock]$ScriptBlock)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $global:LASTEXITCODE = $null
    $output = & $ScriptBlock 2>&1 | ForEach-Object { "$_" }
    return @{ Output = $output; ExitCode = $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [string[]]$Arguments
  )

  $result = Invoke-NativeCapture { & $FilePath @Arguments }
  $result.Output | ForEach-Object { Write-Host $_ }
  if ($result.ExitCode -ne 0) {
    throw "$FilePath failed with exit code $($result.ExitCode)."
  }
}

function Get-GitOutput {
  param([Parameter(Mandatory)] [string[]]$Arguments)
  $result = Invoke-NativeCapture { & git @Arguments }
  if ($result.ExitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $($result.ExitCode)."
  }
  return ($result.Output | Out-String).Trim()
}

if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
  throw 'ssh.exe is required. Configure the SSH alias before deploying.'
}

if ($SshTarget -notmatch '^[a-zA-Z0-9._-]+$') { throw 'SshTarget contains unsupported characters.' }
if ($RemoteDir -notmatch '^/[a-zA-Z0-9._/-]+$') { throw 'RemoteDir must be an absolute Unix path.' }
if ($Branch -notmatch '^[a-zA-Z0-9._/-]+$') { throw 'Branch contains unsupported characters.' }
if ($ContainerName -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'ContainerName contains unsupported characters.' }
if ($ImageRepository -notmatch '^[a-zA-Z0-9_./-]+$') { throw 'ImageRepository contains unsupported characters.' }
if ($DataVolume -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'DataVolume contains unsupported characters.' }
if ($HostPort -lt 1 -or $HostPort -gt 65535) { throw 'HostPort is outside the valid range.' }
if ($CandidatePort -lt 1 -or $CandidatePort -gt 65535 -or $CandidatePort -eq $HostPort) {
  throw 'CandidatePort must be valid and different from HostPort.'
}

$dirtyFiles = @(git status --porcelain)
if ($dirtyFiles.Count -gt 0) {
  throw "Working tree is dirty. Commit or clean it before deploying:`n$($dirtyFiles -join "`n")"
}

$localCommit = Get-GitOutput @('rev-parse', 'HEAD')
$shortCommit = $localCommit.Substring(0, 7)
$remoteCommit = Get-GitOutput @('ls-remote', 'origin', "refs/heads/$Branch")
$remoteCommit = ($remoteCommit -split '\s+')[0]

if ($remoteCommit -ne $localCommit) {
  if (-not $Push) {
    throw "origin/$Branch does not point to local commit $shortCommit. Re-run with -Push to sync first."
  }
  Invoke-CheckedCommand -FilePath 'git' -Arguments @('push', 'origin', "HEAD:$Branch")
  $remoteCommit = Get-GitOutput @('ls-remote', 'origin', "refs/heads/$Branch")
  $remoteCommit = ($remoteCommit -split '\s+')[0]
}

if ($remoteCommit -ne $localCommit) {
  throw "Remote sync verification failed. Expected $localCommit but found $remoteCommit."
}

$remoteScriptTemplate = @'
set -eu
cd '__REMOTE_DIR__'
git fetch --prune origin '__BRANCH__'
git checkout --detach '__COMMIT__'
test "$(git rev-parse HEAD)" = '__COMMIT__'

old_container='__CONTAINER__'
candidate_container='__CONTAINER__-candidate-__SHORT_COMMIT__'
rollback_container='__CONTAINER__-rollback-__SHORT_COMMIT__'
env_file="$(mktemp)"
runtime_env_file="$(mktemp)"
sentry_env_file="$(mktemp)"
cleanup_candidate() {
  docker rm -f "$candidate_container" >/dev/null 2>&1 || true
  rm -f "$env_file"
  rm -f "$runtime_env_file"
  rm -f "$sentry_env_file"
}
trap cleanup_candidate EXIT

if docker inspect "$old_container" >/dev/null 2>&1; then
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$old_container" > "$env_file"
else
  : > "$env_file"
fi
# A server-side .env is the durable override for future deployments. It is
# appended after the old container environment so one-time Sentry setup does
# not require rebuilding or editing this repository.
if [ -f .env ]; then
  cat .env >> "$env_file"
fi
# Keep source-map upload credentials out of the running container. The app
# only needs its DSN, environment, release, and sample rate at runtime.
awk -F= '$1 != "SENTRY_AUTH_TOKEN" && $1 != "SENTRY_ORG" && $1 != "SENTRY_PROJECT"' "$env_file" > "$runtime_env_file"

env_value() {
  key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' "$env_file"
}

sentry_dsn="$(env_value NEXT_PUBLIC_SENTRY_DSN)"
sentry_dsn="${sentry_dsn:-$(env_value SENTRY_DSN)}"
sentry_environment="$(env_value NEXT_PUBLIC_SENTRY_ENVIRONMENT)"
sentry_environment="${sentry_environment:-$(env_value SENTRY_ENVIRONMENT)}"
sentry_environment="${sentry_environment:-production}"
sentry_sample_rate="$(env_value NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)"
sentry_sample_rate="${sentry_sample_rate:-$(env_value SENTRY_TRACES_SAMPLE_RATE)}"
sentry_sample_rate="${sentry_sample_rate:-0.2}"
{
  printf 'SENTRY_AUTH_TOKEN=%s\n' "$(env_value SENTRY_AUTH_TOKEN)"
  printf 'SENTRY_ORG=%s\n' "$(env_value SENTRY_ORG)"
  printf 'SENTRY_PROJECT=%s\n' "$(env_value SENTRY_PROJECT)"
} > "$sentry_env_file"
DOCKER_BUILDKIT=1 docker build \
  --secret "id=sentry_env,src=$sentry_env_file" \
  --label 'org.opencontainers.image.revision=__COMMIT__' \
  --build-arg "NEXT_PUBLIC_SENTRY_DSN=$sentry_dsn" \
  --build-arg "NEXT_PUBLIC_SENTRY_ENVIRONMENT=$sentry_environment" \
  --build-arg "NEXT_PUBLIC_SENTRY_RELEASE=anchor-read@__SHORT_COMMIT__" \
  --build-arg "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$sentry_sample_rate" \
  -t '__IMAGE_TAG__' .
docker volume create '__DATA_VOLUME__' >/dev/null

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

docker rm -f "$candidate_container" >/dev/null 2>&1 || true
docker run -d --name "$candidate_container" --env-file "$runtime_env_file" --env "SENTRY_RELEASE=anchor-read@__SHORT_COMMIT__" --mount type=volume,src='__DATA_VOLUME__',dst=/data --restart no -p 127.0.0.1:__CANDIDATE_PORT__:3000 '__IMAGE_TAG__' >/dev/null
check_url http://127.0.0.1:__CANDIDATE_PORT__/
docker rm -f "$candidate_container" >/dev/null

docker ps -a --format '{{.Names}}' | grep '^__CONTAINER__-rollback-' | while read -r stale; do
  docker rm -f "$stale" >/dev/null
done || true

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

if ! docker run -d --name "$old_container" --env-file "$runtime_env_file" --env "SENTRY_RELEASE=anchor-read@__SHORT_COMMIT__" --mount type=volume,src='__DATA_VOLUME__',dst=/data --restart unless-stopped -p 127.0.0.1:__HOST_PORT__:3000 '__IMAGE_TAG__' >/dev/null; then
  restore_rollback
  exit 1
fi

if ! check_url http://127.0.0.1:__HOST_PORT__/; then
  restore_rollback
  exit 1
fi

docker inspect "$old_container" --format 'deployed_image={{.Config.Image}} status={{.State.Status}} commit=__COMMIT__'
'@

$imageTag = "${ImageRepository}:$localCommit"
$remoteScript = $remoteScriptTemplate
$remoteScript = $remoteScript.Replace('__REMOTE_DIR__', $RemoteDir)
$remoteScript = $remoteScript.Replace('__BRANCH__', $Branch)
$remoteScript = $remoteScript.Replace('__COMMIT__', $localCommit)
$remoteScript = $remoteScript.Replace('__SHORT_COMMIT__', $shortCommit)
$remoteScript = $remoteScript.Replace('__IMAGE_TAG__', $imageTag)
$remoteScript = $remoteScript.Replace('__CONTAINER__', $ContainerName)
$remoteScript = $remoteScript.Replace('__DATA_VOLUME__', $DataVolume)
$remoteScript = $remoteScript.Replace('__HOST_PORT__', [string]$HostPort)
$remoteScript = $remoteScript.Replace('__CANDIDATE_PORT__', [string]$CandidatePort)
# SSH executes this payload on Linux; normalize the repository's CRLF text first.
$remoteScript = $remoteScript.Replace("`r`n", "`n")

$sshResult = Invoke-NativeCapture {
  & ssh.exe -o BatchMode=yes -o ConnectTimeout=15 $SshTarget $remoteScript
}
$sshResult.Output | ForEach-Object { Write-Host $_ }
if ($sshResult.ExitCode -ne 0) {
  throw "Remote deployment failed with exit code $($sshResult.ExitCode)."
}

if (-not $SkipHealthCheck) {
  $separator = if ($HealthUrl.Contains('?')) { '&' } else { '?' }
  $probeUrl = "${HealthUrl}${separator}deploy=$shortCommit"
  $response = Invoke-WebRequest -Uri $probeUrl -Method Get -MaximumRedirection 5 -TimeoutSec 30 -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "Online health check failed with HTTP $($response.StatusCode)."
  }
  Write-Host "Online health check passed: $HealthUrl (commit $shortCommit)."
}

Write-Host "Deployment complete: $localCommit."
