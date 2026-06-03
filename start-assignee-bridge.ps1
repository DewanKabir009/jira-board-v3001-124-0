$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $workspace

$env:APPDATA = Join-Path $env:USERPROFILE "AppData\Roaming"
$env:GH_CONFIG_DIR = Join-Path $env:APPDATA "GitHub CLI"
$env:GH_PATH = "C:\Program Files\GitHub CLI\gh.exe"

$env:GH_TOKEN = (& $env:GH_PATH auth token).Trim()

& "C:\Program Files\nodejs\node.exe" "scripts\dispatch-assignee-workflow-server.cjs" *> "assignee-dispatch.out.log"
