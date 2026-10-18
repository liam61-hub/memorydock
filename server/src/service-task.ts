import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SERVICE_TASK_NAME = 'MemoryDock Serve';

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function serviceCommand(nodePath: string, cliPath: string): string {
  const script = `
$ErrorActionPreference = 'Stop'
$logDirectory = Join-Path (Join-Path $env:USERPROFILE '.memorydock') 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory 'serve.log'
& ${powershellLiteral(nodePath)} ${powershellLiteral(cliPath)} serve *>> $logPath
exit $LASTEXITCODE
`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function run(command: string, args: string[], env = process.env): Promise<void> {
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let errorOutput = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    if (errorOutput.length < 4096) errorOutput += chunk.toString('utf8').slice(0, 4096 - errorOutput.length);
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `${command} exited with code ${code}`));
    });
  });
}

function windowsOnly(): void {
  if (process.platform !== 'win32') throw new Error('On-demand service tasks are supported on Windows only');
}

/** Register a user-owned, on-demand task without a logon or time trigger. */
export async function installServiceTask(): Promise<void> {
  windowsOnly();
  const encodedService = serviceCommand(process.execPath, fileURLToPath(new URL('./cli.js', import.meta.url)));
  const script = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodedService}'
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'MemoryDock Serve' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
}

export async function removeServiceTask(): Promise<void> {
  windowsOnly();
  const script = `
$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'MemoryDock Serve' -Confirm:$false
`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
}

/** The Task Scheduler starts the service outside the MCP client's sandbox. */
export async function startServiceTask(): Promise<void> {
  windowsOnly();
  try {
    await run('schtasks.exe', ['/run', '/tn', SERVICE_TASK_NAME]);
  } catch (error) {
    // Another client may have started this same task. If it still exists,
    // the caller should wait for the shared API to become ready.
    try { await run('schtasks.exe', ['/query', '/tn', SERVICE_TASK_NAME]); }
    catch { throw error; }
  }
}
