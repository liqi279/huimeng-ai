# 打 SCF 代码包：server/dist/huimeng-scf.zip
# 用法：在 server 目录执行
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-scf.ps1
# 产出 zip 根目录：scf.js + src/ + node_modules/（仅生产依赖）
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'

$serverDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $serverDir 'dist\stage'
$zip = Join-Path $serverDir 'dist\huimeng-scf.zip'

if (-not (Test-Path (Join-Path $serverDir 'scf.js'))) {
  throw "找不到 server/scf.js，请先把 scf.js 放到 server 根目录"
}
if (-not (Test-Path (Join-Path $serverDir 'package-lock.json'))) {
  throw "缺少 package-lock.json；先在 server 目录执行 npm install 生成锁文件"
}

if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# 1) 拷贝运行所需文件（不拷 node_modules，稍后用 npm ci 只装生产依赖）
Copy-Item -LiteralPath (Join-Path $serverDir 'scf.js') -Destination $stage
Copy-Item -LiteralPath (Join-Path $serverDir 'src') -Destination $stage -Recurse
# data/mysql/schema.sql 与 data/library/books.seed.json：SCF 的 DATA_ROOT 是 /tmp，
# 不带这两份就得依赖「库里表已存在」，带上是双保险
if (Test-Path (Join-Path $serverDir 'data')) {
  Copy-Item -LiteralPath (Join-Path $serverDir 'data') -Destination $stage -Recurse
}
Copy-Item -LiteralPath (Join-Path $serverDir 'package.json') -Destination $stage
# lock 只用于 npm ci，不进 zip
Copy-Item -LiteralPath (Join-Path $serverDir 'package-lock.json') -Destination $stage

# 2) 生产依赖：优先直接复用 server/node_modules（离线、快、与本地验证过的一致）；
#    只有本地没有 node_modules 时才回退 npm ci 安装。
$srcModules = Join-Path $serverDir 'node_modules'
if (Test-Path -LiteralPath $srcModules) {
  Write-Host "复用 server/node_modules（离线拷贝，不联网）"
  Copy-Item -LiteralPath $srcModules -Destination $stage -Recurse -Force
} else {
  Push-Location $stage
  try {
    npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci 失败，退出码 $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}
# lock 只服务 npm ci，装完删掉，zip 顶层只留 scf.js / src / node_modules / package.json
Remove-Item -LiteralPath (Join-Path $stage 'package-lock.json') -Force -ErrorAction SilentlyContinue

# 3) 剔除无用文件
$junk = @('*.md', '*.map', '.env*', '*.log', 'test', 'tests', '__tests__', '.github', '.bin')
foreach ($p in $junk) {
  Get-ChildItem -Path $stage -Filter $p -Recurse -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

# 4) 压缩：必须自己写 zip，保证条目分隔符是 '/'（Linux 解压才能还原目录）
#    Compress-Archive 在 Windows PowerShell 5.1 下会把条目写成 'node_modules\express\...'，
#    SCF（Linux）解压后不会生成目录，函数会找不到模块。
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fs = [IO.File]::Open($zip, [IO.FileMode]::Create)
$archive = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
try {
  $baseLen = $stage.Length + 1
  Get-ChildItem -Path $stage -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($baseLen).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose()
  $fs.Dispose()
}

$size = (Get-Item -LiteralPath $zip).Length
$mb = [Math]::Round($size / 1MB, 2)
Write-Host ""
Write-Host ("ZIP: " + $zip)
Write-Host ("体积: " + $size + " B (" + $mb + " MB)")

if ($mb -gt 50) {
  Write-Warning "超过 50 MB，控制台直传可能失败，请改用 COS 中转上传（见交付说明第 3 节）"
} else {
  Write-Host "在 50 MB 以内，可直接在 SCF 控制台上传"
}
