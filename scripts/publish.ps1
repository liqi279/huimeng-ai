# 一键交付（Windows）：语法检查 → 构建 → 提交 → 推送 → 等 CI → 线上自检
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish.ps1 "feat: 改了什么/为什么"
#   ... -DryRun    只检查不提交不推送
#   ... -NoBuild   跳过构建（只改文档/脚本时）
#   ... -NoWait    推送后不等 CI 结论
#
# 推送 main 即发布，两条流水线自动接管：
#   deploy-pages.yml  前端 → GitHub Pages（deploy/ 产物）
#   deploy-scf.yml    后端 → 腾讯云 SCF（仅 server/** 变更时触发）
# 数据库没有独立步骤：TiDB 建表/加列在函数启动时幂等执行。
#
# 本脚本只做编排；HTTP 探活交给 node（本机 PowerShell 的 schannel 取不到凭证）。
# 注意：本文件必须保留 UTF-8 BOM，否则中文在 Windows PowerShell 5.1 下会乱码并解析失败。

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Message,
    [switch]$DryRun,
    [switch]$NoBuild,
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

function Fail([string]$Text) {
    Write-Host ""
    Write-Host "[ABORT] $Text" -ForegroundColor Red
    exit 1
}

# git 包装：PowerShell 捕获原生命令输出是可行的（node 的 spawnSync 在本沙箱会被 EPERM 拦掉）。
# git 把进度写到 stderr，$ErrorActionPreference='Stop' 时 2>&1 会把进度当成终止性错误，这里临时放宽。
function Invoke-Git {
    param([string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $Root @GitArgs 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $prev
    }
    return [pscustomobject]@{ Code = $code; Text = (($out | ForEach-Object { "$_" }) -join "`n") }
}

# 出网到 GitHub 时好时坏（本机没走代理），网络类失败自动重试几次再判定失败
function Invoke-GitRetry {
    param([string[]]$GitArgs, [int]$Attempts = 4, [int]$DelaySeconds = 8)
    $result = $null
    for ($i = 1; $i -le $Attempts; $i++) {
        $result = Invoke-Git $GitArgs
        if ($result.Code -eq 0) { return $result }
        if ($i -lt $Attempts) {
            Write-Host ("  第 " + $i + " 次失败，等 " + $DelaySeconds + " 秒重试") -ForegroundColor Yellow
            Start-Sleep -Seconds $DelaySeconds
        }
    }
    return $result
}

function Resolve-Node {
    $c = Get-Command node -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in @($env:DSH_NODE, "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe")) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

$Node = Resolve-Node
if (-not $Node) { Fail "找不到 node，请放进 PATH 或设置 DSH_NODE" }

Write-Host ""
Write-Host "=== 前置检查 ===" -ForegroundColor Cyan
$status = Invoke-Git @('status', '-sb')
Write-Host ("  " + ($status.Text -split "`n")[0])

$branch = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Text.Trim()
if ($branch -ne 'main') { Fail "当前分支是 '$branch'，本脚本只发布 main" }

$who = (Invoke-Git @('config', 'user.email')).Text.Trim()
if (-not $who) { Fail "没有配置提交身份，先执行：git config --local user.name / user.email" }

Invoke-GitRetry @('fetch', 'origin', 'main') | Out-Null
$counts = (Invoke-Git @('rev-list', '--left-right', '--count', 'main...origin/main')).Text.Trim() -split '\s+'
$behind = [int]$counts[1]
Write-Host ("  本地领先 " + $counts[0] + " 个提交，落后 " + $behind + " 个提交")
if ($behind -gt 0) {
    Fail "本地落后远程 $behind 个提交，推送会被拒。先 git pull --ff-only origin main"
}

$porcelain = Invoke-Git @('status', '--porcelain')
$changed = @()
foreach ($line in ($porcelain.Text -split "`n")) {
    if ($line.Trim().Length -gt 3) { $changed += $line.Substring(3).Trim() }
}
$touchesFrontend = @($changed | Where-Object { $_ -like 'frontend/*' -or $_ -eq 'scripts/build-deploy.js' }).Count -gt 0
$touchesServer = @($changed | Where-Object { $_ -like 'server/*' }).Count -gt 0
$feLabel = if ($touchesFrontend) { "是" } else { "否" }
$beLabel = if ($touchesServer) { "是" } else { "否" }
Write-Host ("  改动 " + $changed.Count + " 个文件；前端源码：" + $feLabel + "；后端：" + $beLabel)

Write-Host ""
Write-Host "=== 语法检查 ===" -ForegroundColor Cyan
$jsChanged = @($changed | Where-Object { $_ -like 'frontend/*.js' })
if ($jsChanged.Count -eq 0) {
    Write-Host "  本次没有改动 frontend/*.js，跳过"
}
else {
    foreach ($f in $jsChanged) {
        & $Node --check (Join-Path $Root $f)
        if ($LASTEXITCODE -ne 0) { Fail "语法检查未通过：$f（未提交）" }
        Write-Host "  PASS  node --check $f" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=== 构建产物 ===" -ForegroundColor Cyan
if ($DryRun) { Write-Host "  -DryRun：跳过构建" }
elseif ($NoBuild) { Write-Host "  -NoBuild：跳过构建" }
elseif (-not $touchesFrontend) { Write-Host "  未改动 frontend/，不重建（避免无意义产物 diff）" }
else {
    & $Node (Join-Path $Root 'scripts/build-deploy.js')
    if ($LASTEXITCODE -ne 0) { Fail "构建失败（未提交）" }
    Write-Host "  PASS  node scripts/build-deploy.js" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 提交 ===" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  -DryRun：不提交、不推送"
    Write-Host ""
    Write-Host ("  将提交：" + $Message)
    $changed | Select-Object -First 40 | ForEach-Object { Write-Host ("    " + $_) }
    exit 0
}

Invoke-Git @('add', '-A') | Out-Null
$staged = (Invoke-Git @('diff', '--cached', '--name-only')).Text.Trim()
if (-not $staged) { Fail "没有可提交的改动（工作区干净）" }
Write-Host ("  暂存 " + @($staged -split "`n").Count + " 个文件")

$commit = Invoke-Git @('commit', '-m', $Message)
if ($commit.Code -ne 0) { Write-Host $commit.Text; Fail "提交失败" }
$sha = (Invoke-Git @('rev-parse', '--short', 'HEAD')).Text.Trim()
$subject = (Invoke-Git @('log', '-1', '--pretty=%s')).Text.Trim()
Write-Host ("  PASS  commit " + $sha + "  " + $subject) -ForegroundColor Green

Write-Host ""
Write-Host "=== 推送 ===" -ForegroundColor Cyan
$push = Invoke-GitRetry @('push', 'origin', 'main')
if ($push.Code -ne 0) { Write-Host $push.Text; Fail "推送失败（重试后仍失败，未做任何强制覆盖）" }
$fullSha = (Invoke-Git @('rev-parse', 'HEAD')).Text.Trim()
Write-Host ("  PASS  已推送到 origin/main  " + $fullSha.Substring(0, 7)) -ForegroundColor Green

Write-Host ""
Write-Host "=== CI 与线上自检 ===" -ForegroundColor Cyan
$verifyArgs = @((Join-Path $Root 'scripts/verify-live.js'), '--sha', $fullSha)
if ($touchesServer) { $verifyArgs += '--expect-scf' }
if ($NoWait) { $verifyArgs += '--no-wait' }
& $Node @verifyArgs
$verifyCode = $LASTEXITCODE

Write-Host ""
Write-Host "=== 交付信息 ===" -ForegroundColor Cyan
Write-Host "  GitHub 仓库：https://github.com/liqi279/huimeng-ai"
Write-Host ("  本次 commit：" + $sha + " " + $subject + "（已推送到 main）")
Write-Host "  前端页面：https://liqi279.github.io/huimeng-ai/"
if ($verifyCode -ne 0) { Fail "自检有失败项，请看上面的 FAIL 行" }
Write-Host ""
Write-Host "  全部通过。" -ForegroundColor Green
