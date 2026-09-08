<#
.SYNOPSIS
    AnchorRead 部署触发器：触发 GitHub Actions 的 Deploy 工作流并监控到结束，再做线上健康检查。

.DESCRIPTION
    构建与部署已迁移到 CI/CD（见 .github/workflows/deploy.yml）：
      - GitHub Actions 在托管 runner 构建 linux/amd64 镜像并推送到 GHCR；
      - 通过 SSH 调用 scripts/remote-deploy.sh 在生产服务器 docker pull + 蓝绿切换。
    本脚本不再在本地或服务器构建，只负责「触发 + 监控 + 线上校验」。

    两种触发方式：
      - 默认：workflow_dispatch 手动触发（要求 deploy.yml 已在默认分支）。
      - -Push：先把 HEAD 推到 origin/<Ref>，push 事件自动触发部署；
               若远端已是最新（无 push 事件），自动回退为 workflow_dispatch。

    首次使用请用 -Push：deploy.yml 尚未上默认分支时 workflow_dispatch 不可用，
    而 push 事件会用被推送的提交里的 workflow 直接触发首次部署。

.EXAMPLE
    .\scripts\deploy-server.ps1 -Push
.EXAMPLE
    .\scripts\deploy-server.ps1            # 手动重新部署当前 main
#>
[CmdletBinding()]
param(
  [string]$Ref = 'main',
  [string]$Workflow = 'deploy.yml',
  [string]$HealthUrl = 'https://anchorread.flowguide.cc/',
  [int]$RunWaitSeconds = 150,
  [switch]$Push,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = 'Stop'

# 原生命令（git/gh）的进度信息走 stderr：Stop 偏好会把它升级为错误并中断，
# 故统一以退出码判定成败。
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

if ($Ref -notmatch '^[a-zA-Z0-9._/-]+$') { throw 'Ref 含不支持的字符。' }
if ($Workflow -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Workflow 含不支持的字符。' }

# --- gh CLI 前置检查 ---
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) 未安装或不在 PATH。请安装后执行 gh auth login（需 repo + workflow 权限）。'
}
$authCheck = Invoke-NativeCapture { & gh auth status }
if ($authCheck.ExitCode -ne 0) {
  throw "gh 未认证。请先执行 'gh auth login'。"
}
$repoResult = Invoke-NativeCapture { & gh repo view --json nameWithOwner --jq '.nameWithOwner' }
if ($repoResult.ExitCode -ne 0) { throw '无法确定当前 GitHub 仓库，请在仓库根目录运行。' }
Write-Host "仓库：$(($repoResult.Output | Out-String).Trim())"

function Get-LatestRunId {
  $r = Invoke-NativeCapture { & gh run list --workflow $Workflow --branch $Ref --limit 1 --json databaseId --jq '.[0].databaseId' }
  if ($r.ExitCode -ne 0) { return $null }
  $v = ($r.Output | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($v) -or $v -eq 'null') { return $null }
  return $v
}

# 记录触发前的最新 run，用于识别本次新建的 run
$beforeRunId = Get-LatestRunId

# --- 可选：推送（push 事件会自动触发部署）---
$upToDate = $false
if ($Push) {
  $dirty = @(git status --porcelain)
  if ($dirty.Count -gt 0) { throw "工作区不干净，先提交或清理：`n$($dirty -join "`n")" }
  Write-Host "推送 HEAD 到 origin/$Ref ..."
  $pushResult = Invoke-NativeCapture { & git push origin "HEAD:$Ref" }
  $pushResult.Output | ForEach-Object { Write-Host $_ }
  if ($pushResult.ExitCode -ne 0) { throw "git push 失败（退出码 $($pushResult.ExitCode)）。" }
  $upToDate = (($pushResult.Output | Out-String) -match 'Everything up-to-date')
  if ($upToDate) { Write-Host "origin/$Ref 已是最新，无 push 事件；改用 workflow_dispatch 触发。" }
}

# --- 触发：非 push，或 push 但远端已最新 ---
if ((-not $Push) -or $upToDate) {
  Write-Host "手动触发 $Workflow（ref=$Ref）..."
  $trig = Invoke-NativeCapture { & gh workflow run $Workflow --ref $Ref }
  $trig.Output | ForEach-Object { Write-Host $_ }
  if ($trig.ExitCode -ne 0) {
    throw "触发失败（退出码 $($trig.ExitCode)）。若提示 workflow_dispatch 不可用，说明 $Workflow 尚未在默认分支；请改用 -Push 让首次部署随提交上线。"
  }
}

# --- 轮询等待本次 run 出现 ---
$runId = $null
$deadline = (Get-Date).AddSeconds($RunWaitSeconds)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 4
  $candidate = Get-LatestRunId
  if ($candidate -and $candidate -ne $beforeRunId) { $runId = $candidate; break }
}
if (-not $runId) { throw "未能在 $RunWaitSeconds 秒内识别到本次触发的 run。请到 Actions 页面手动确认。" }
Write-Host "监控 run：$runId"

# --- 监控直到结束（--exit-status：run 失败时 gh 返回非零）---
$watch = Invoke-NativeCapture { & gh run watch $runId --exit-status --interval 15 }
$watch.Output | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
if ($watch.ExitCode -ne 0) {
  throw "部署 run $runId 失败（退出码 $($watch.ExitCode)）。用 'gh run view $runId --log-failed' 查看失败日志；生产已由 remote-deploy.sh 的自动回滚保护。"
}
Write-Host "部署 run $runId 成功。"

# --- 线上健康检查 ---
if (-not $SkipHealthCheck) {
  $short = ((Invoke-NativeCapture { & git rev-parse --short=7 HEAD }).Output | Out-String).Trim()
  $separator = if ($HealthUrl.Contains('?')) { '&' } else { '?' }
  $probeUrl = if ($short) { "${HealthUrl}${separator}deploy=$short" } else { $HealthUrl }
  $response = Invoke-WebRequest -Uri $probeUrl -Method Get -MaximumRedirection 5 -TimeoutSec 30 -UseBasicParsing
  if ($response.StatusCode -ne 200) { throw "线上健康检查失败：HTTP $($response.StatusCode)。" }
  Write-Host "线上健康检查通过：$HealthUrl（commit $short）。"
}

Write-Host "部署完成。"
