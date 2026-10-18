param([switch]$Apply, [switch]$Verify)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$serverRoot = Join-Path $repoRoot 'server'
$codexConfig = Join-Path $env:USERPROFILE '.codex\config.toml'
$claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
$taskName = 'MemoryDock Serve'

if ($Apply -and $Verify) { throw 'Choose -Apply or -Verify.' }

if (-not $Apply -and -not $Verify) {
    Write-Host "Active source: $serverRoot"
    Write-Host 'Dry run: this script will check the source version, pack and install the local MemoryDock package globally,'
    Write-Host 'replace the user-owned service task with a hidden launcher,'
    Write-Host 'replace the user-scoped MemoryDock MCP entries in Codex and Claude Code,'
    Write-Host 'and allow Codex to call MemoryDock tools. Existing config files will be backed up.'
    Write-Host 'Run with -Apply to make these changes.'
    Write-Host 'Run with -Verify to check an existing installation without changes.'
    exit 0
}

if ($Apply) {
    $sourceVersion = (Get-Content -LiteralPath (Join-Path $serverRoot 'package.json') -Raw | ConvertFrom-Json).version
    $cache = Join-Path $repoRoot '.npm-cache'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    Push-Location -LiteralPath $serverRoot
    try {
        & npm.cmd run check:local-version
        if ($LASTEXITCODE -ne 0) { throw 'Source version is older than the installed package.' }
        & npm.cmd pack --pack-destination $serverRoot --cache $cache
        if ($LASTEXITCODE -ne 0) { throw 'Packaging MemoryDock failed.' }
    } finally {
        Pop-Location
    }
    $tarball = Join-Path $serverRoot "memorydock-$sourceVersion.tgz"
    if (-not (Test-Path -LiteralPath $tarball)) { throw "Package not found: $tarball" }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    foreach ($configPath in @($codexConfig, $claudeConfig)) {
        if (Test-Path -LiteralPath $configPath) {
            Copy-Item -LiteralPath $configPath -Destination "$configPath.$stamp.bak" -ErrorAction Stop
        }
    }

    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $existingTask -and $existingTask.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $taskName
    }
    & npm.cmd install -g $tarball
    if ($LASTEXITCODE -ne 0) { throw 'Installing the packed MemoryDock package failed.' }
}

$globalRoot = (& npm.cmd root -g).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not locate the global npm package root.' }
$cliPath = Join-Path $globalRoot 'memorydock\dist\cli.js'
if (-not (Test-Path -LiteralPath $cliPath)) { throw "MemoryDock CLI is missing: $cliPath" }
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$installedVersion = (& $nodePath $cliPath --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Installed MemoryDock version check failed.' }
if ($Apply -and $installedVersion -ne $sourceVersion) { throw "Installed $installedVersion; expected $sourceVersion." }

if ($Apply) {
    & $nodePath $cliPath service install
    if ($LASTEXITCODE -ne 0) { throw 'Registering the hidden MemoryDock service task failed.' }

    & codex.cmd mcp remove memorydock
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the old Codex MemoryDock entry.' }
    & codex.cmd mcp add memorydock -- $nodePath $cliPath mcp
    if ($LASTEXITCODE -ne 0) { throw 'Could not add the Codex MemoryDock entry.' }

    $toml = [System.IO.File]::ReadAllText($codexConfig)
    $section = [regex]::Match($toml, '(?ms)^\[mcp_servers\.memorydock\]\r?\n(?<body>.*?)(?=^\[|\z)')
    if (-not $section.Success) { throw 'Codex did not write the expected MemoryDock section.' }
    if ($section.Groups['body'].Value -notmatch '(?m)^default_tools_approval_mode\s*=') {
        $insertAt = $section.Groups['body'].Index
        $toml = $toml.Insert($insertAt, "default_tools_approval_mode = `"approve`"`n")
        [System.IO.File]::WriteAllText($codexConfig, $toml, [System.Text.UTF8Encoding]::new($false))
    }

    & claude.cmd mcp remove memorydock --scope user
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the old Claude Code MemoryDock entry.' }
    & claude.cmd mcp add --transport stdio --scope user memorydock -- $nodePath $cliPath mcp
    if ($LASTEXITCODE -ne 0) { throw 'Could not add the Claude Code MemoryDock entry.' }
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if ($task.Actions[0].Execute -notmatch 'powershell\.exe$' -or $task.Actions[0].Arguments -notmatch '-WindowStyle Hidden') {
    throw 'MemoryDock service task does not use the hidden launcher. Run with -Apply.'
}
if ($Apply) {
    Start-ScheduledTask -TaskName $taskName
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        $running = (Get-ScheduledTask -TaskName $taskName).State -eq 'Running'
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:40889/health/liveness' -TimeoutSec 2
            if ($running -and $health.status -eq 'alive') { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { throw 'The hidden MemoryDock task did not become healthy. Check ~/.memorydock/logs/serve.log.' }
}

& $nodePath $cliPath doctor
if ($LASTEXITCODE -ne 0) { throw 'MemoryDock diagnostics failed.' }
$smokeInput = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'mcp-tools-smoke.jsonl'))
$smokeOutput = $smokeInput | & $nodePath $cliPath mcp
if ($LASTEXITCODE -ne 0 -or ($smokeOutput -join "`n") -notmatch '"name":"list_memories"') {
    throw 'The installed MemoryDock MCP tool catalog did not expose list_memories.'
}
& codex.cmd mcp list
if ($LASTEXITCODE -ne 0) { throw 'Codex MCP listing failed.' }
$claudeStatus = & claude.cmd mcp get memorydock
if ($LASTEXITCODE -ne 0 -or ($claudeStatus -join "`n") -match 'Failed to connect|Pending approval|Rejected|Disabled') {
    throw 'Claude Code did not connect to MemoryDock. Inspect the output of claude mcp get memorydock.'
}

if ($Apply) {
    Write-Host "MemoryDock $installedVersion is installed from root/server with a hidden service task. Restart Codex and Claude Code sessions."
} else {
    Write-Host "MemoryDock $installedVersion configuration verification passed."
}
