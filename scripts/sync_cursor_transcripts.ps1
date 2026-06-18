# 同步 Cursor 会话记录到仓库并推送到 Gitee
#
# 用法（PowerShell）：
#   $env:GITEE_TOKEN = "你的私人令牌"   # 可选：用于自动创建仓库
#   .\scripts\sync_cursor_transcripts.ps1
#   git push gitee main
#
# 若 Gitee 上尚无 Downaigc 仓库：
#   1. 打开 https://gitee.com/projects/new
#   2. 仓库名填 Downaigc，选私有，不要勾选「使用 Readme 初始化」
#   3. 创建后执行 git push -u gitee main

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$cursorProject = "$env:USERPROFILE\.cursor\projects\d-1code-cursor-downAiGC"
$transcriptSrc = Join-Path $cursorProject "agent-transcripts"
$transcriptDst = Join-Path $root "docs\cursor-agent-transcripts"
$uploadSrc = Join-Path $cursorProject "uploads"
$uploadDst = Join-Path $root "docs\cursor-uploads"

if (-not (Test-Path $transcriptSrc)) {
  Write-Warning "未找到 Cursor 会话目录: $transcriptSrc"
  exit 1
}

Write-Host "同步 agent-transcripts -> docs/cursor-agent-transcripts"
robocopy $transcriptSrc $transcriptDst /E /XO /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -gt 7) { exit $LASTEXITCODE }

if (Test-Path $uploadSrc) {
  New-Item -ItemType Directory -Force -Path $uploadDst | Out-Null
  Write-Host "同步 uploads -> docs/cursor-uploads"
  robocopy $uploadSrc $uploadDst /E /XO /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -gt 7) { exit $LASTEXITCODE }
}

Push-Location $root
$changes = git status --porcelain docs/cursor-agent-transcripts docs/cursor-uploads 2>$null
if ($changes) {
  git add docs/cursor-agent-transcripts docs/cursor-uploads
  git commit -m "chore: sync Cursor agent transcripts and uploads"
  Write-Host "已提交会话记录更新"
} else {
  Write-Host "会话记录无新变化"
}
Pop-Location

if ($env:GITEE_TOKEN) {
  $repoUrl = "https://gitee.com/api/v5/user/repos"
  $body = @{
    access_token = $env:GITEE_TOKEN
    name         = "Downaigc"
    private      = $true
    description  = "downAiGC 论文润色与运营控制台"
    has_issues   = $false
    has_wiki     = $false
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri $repoUrl -Method Post -Body $body -ContentType "application/json" | Out-Null
    Write-Host "已在 Gitee 创建仓库 k856487/Downaigc"
  } catch {
    if ($_.Exception.Message -match "already exists|已存在") {
      Write-Host "仓库 Downaigc 已存在，跳过创建"
    } else {
      Write-Warning "自动创建仓库失败: $($_.Exception.Message)"
    }
  }
}

Write-Host "完成。请执行: git push -u gitee main"
