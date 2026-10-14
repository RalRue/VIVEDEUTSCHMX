#!/usr/bin/env node
import { execFile as nativeExecFile } from 'node:child_process';
import * as nativeFs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_REMOTE } from './codex-bridge.mjs';
import { terminateCodexProcess } from './codex-bridge-codex.mjs';

export const TASK_NAME = 'VIVE-Codex-Bridge-Zoohaus';
export const OWNER = 'Managed by vive-codex-bridge-zoohaus/v1';
export const SCHEMA = 'codex-bridge-zoohaus/v1';
const CONFIG_KEYS = ['schema', 'owner', 'ownerSid', 'project', 'node', 'codex', 'git', 'connector', 'runtime',
  'helper', 'config', 'state', 'remote', 'agent', 'allowFrom', 'sandbox', 'maxMessages', 'timeout'];
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const HELP = `Zoohaus Windows connector (Node.js 18+).

  node scripts/codex-bridge-zoohaus.mjs --plan       Preview, no files/tasks written (default)
  node scripts/codex-bridge-zoohaus.mjs --install    Check local access, register and start own task
  node scripts/codex-bridge-zoohaus.mjs --run        Process at most one queued task
  node scripts/codex-bridge-zoohaus.mjs --status     Read own task status
  node scripts/codex-bridge-zoohaus.mjs --pause      Disable future starts; a running job may finish

  --project PATH     Existing checkout; default: current directory
  --codex PATH       Optional absolute native codex.exe (never codex.cmd)
  --git PATH         Optional absolute git.exe
  --config PATH      Scheduled-task use only: must equal the managed LOCALAPPDATA path
  --help             Show this help

Runtime scripts may be outside the checkout. Config/state remain in
LOCALAPPDATA/vive-codex-bridge/zoohaus. No credentials are saved there.
Fixed inbox cloud, allowed sender local, private mailbox, read-only, one task per run.
Task Scheduler: current interactive user, Limited, IgnoreNew, logon/every minute, no wake.
Use one cloud-inbox worker across all computers. Existing login does not prove inference.
Installation must run on Zoohaus itself; a cloud preview does not install on that PC.
`;

export class ZoohausError extends Error {
  constructor(message) { super(message); this.name = 'ZoohausError'; }
}

export function parseZoohausArgs(argv, { cwd = process.cwd() } = {}) {
  const options = { mode: 'plan', project: cwd, help: false };
  let selected;
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (seen.has(flag)) throw new ZoohausError('Duplicate option. See --help.');
    seen.add(flag);
    if (flag === '--help') { options.help = true; continue; }
    if (['--plan', '--install', '--run', '--status', '--pause'].includes(flag)) {
      if (selected) throw new ZoohausError('Choose one mode. See --help.');
      selected = options.mode = flag.slice(2); continue;
    }
    if (!['--project', '--codex', '--git', '--config'].includes(flag)) throw new ZoohausError('Unknown option. See --help.');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new ZoohausError('An option needs a value. See --help.');
    options[flag.slice(2)] = value;
  }
  return options;
}

export function quoteWindowsArgument(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw new ZoohausError('Invalid Windows argument.');
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

export function quoteWindowsArguments(values) { return values.map(quoteWindowsArgument).join(' '); }

function cleanPath(value, p) {
  if (typeof value !== 'string' || !p.isAbsolute(value) || /[\x00-\x1f\x7f"%]/.test(value)) {
    throw new ZoohausError('Use absolute Windows paths without controls, quotes or environment expansions.');
  }
  return p.normalize(value);
}

function samePath(left, right, p) {
  return typeof left === 'string' && typeof right === 'string' && p.normalize(left).toLowerCase() === p.normalize(right).toLowerCase();
}

function inside(parent, child, p) {
  const relative = p.relative(parent.toLowerCase(), child.toLowerCase());
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${p.sep}`) && !p.isAbsolute(relative));
}

function sid(value) {
  return typeof value === 'string' && /^S-1-[0-9]+(?:-[0-9]+)+$/.test(value)
    && !['S-1-5-18', 'S-1-5-19', 'S-1-5-20'].includes(value);
}

function validateConfig(config, expected, p) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).length !== CONFIG_KEYS.length
    || !CONFIG_KEYS.every(key => Object.hasOwn(config, key)) || config.schema !== SCHEMA || config.owner !== OWNER || !sid(config.ownerSid)
    || config.agent !== 'cloud' || JSON.stringify(config.allowFrom) !== '["local"]' || config.sandbox !== 'read-only'
    || config.maxMessages !== 1 || config.timeout !== 900 || config.remote !== DEFAULT_REMOTE) throw new ZoohausError('Unmanaged or invalid Zoohaus configuration; preserving it.');
  for (const name of ['project', 'node', 'codex', 'git', 'connector', 'runtime', 'helper', 'config', 'state']) cleanPath(config[name], p);
  if (p.basename(config.codex).toLowerCase() !== 'codex.exe' || p.basename(config.git).toLowerCase() !== 'git.exe'
    || p.basename(config.node).toLowerCase() !== 'node.exe') throw new ZoohausError('Configuration must use native Node, Codex and Git executables.');
  if ([config.node, config.codex, config.git].some(filename => p.dirname(filename).includes(';'))) throw new ZoohausError('Executable directories must not contain a PATH separator.');
  if (!samePath(config.runtime, p.dirname(p.dirname(config.connector)), p)
    || !samePath(config.helper, p.join(config.runtime, 'scripts', 'codex-bridge-codex.mjs'), p)
    || !samePath(config.state, p.join(p.dirname(config.config), 'cloud.codex.json'), p)
    || inside(config.project, config.config, p) || inside(config.project, config.state, p)
    || inside(config.runtime, config.config, p) || inside(config.runtime, config.state, p)) throw new ZoohausError('Runtime, checkout and private state paths do not match the fixed policy.');
  if (expected && (!samePath(config.config, expected.config, p) || !samePath(config.connector, expected.connector, p)
    || !samePath(config.node, expected.node, p) || config.ownerSid !== expected.ownerSid)) throw new ZoohausError('Configuration belongs to another user, runtime or installation.');
  return config;
}

export function createZoohausPlan(config, { pathApi = path.win32 } = {}) {
  validateConfig(config, null, pathApi);
  return { schema: SCHEMA, platform: 'win32', supported: true, validated: false, config,
    task: { name: TASK_NAME, description: OWNER,
      principal: { userId: config.ownerSid, logonType: 'Interactive', runLevel: 'Limited' },
      action: { execute: config.node, args: quoteWindowsArguments([config.connector, '--run', '--config', config.config]), workingDirectory: config.project },
      triggers: ['logon', 'every-minute'], settings: { multipleInstances: 'IgnoreNew', wakeToRun: false,
        executionTimeLimit: 'PT20M', startWhenAvailable: true } },
    notes: ['Preview only: no scheduled task or files have been installed.',
      'Uses existing local Git and Codex authentication; never saves secret values.',
      'Checks prove configuration and login metadata, not successful model inference.',
      'One cloud-inbox worker across all computers; private mailbox writers must be trusted.',
      'The PC must be running and this user logged in. Pausing leaves any current bounded job to finish.'] };
}

function validTaskSchedule(task, ownerSid) {
  if (task.executionTimeLimitSeconds !== 1_200 || task.startWhenAvailable !== true
    || !Array.isArray(task.triggers) || task.triggers.length !== 2) return false;
  if (task.triggers.some(trigger => !trigger || trigger.enabled !== true || trigger.endBoundary !== ''
    || trigger.durationSeconds !== 0 || trigger.stopAtDurationEnd !== false)) return false;
  const logon = task.triggers.filter(trigger => trigger.kind === 'logon');
  const time = task.triggers.filter(trigger => trigger.kind === 'time');
  return logon.length === 1 && time.length === 1
    && logon[0].userId === ownerSid && logon[0].intervalSeconds === 0 && logon[0].delaySeconds === 0
    && time[0].intervalSeconds === 60 && time[0].randomDelaySeconds === 0
    && typeof time[0].startBoundary === 'string' && Number.isFinite(Date.parse(time[0].startBoundary));
}

function taskTime(value) {
  return typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value)) ? value : null;
}

function powerShellTemplate(operation, data) {
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  const prefix = `# vive-zoohaus: ${operation}\n$ErrorActionPreference = 'Stop'\n$d = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json\n`;
  const currentSid = `[Security.Principal.WindowsIdentity]::GetCurrent().User.Value`;
  const inspect = `$t = Get-ScheduledTask -TaskName $d.name -TaskPath '\\' -ErrorAction SilentlyContinue\n`;
  const schedule = String.raw`
function Schedule-Seconds($value) {
  if ([string]::IsNullOrEmpty([string]$value)) { return 0 }
  return [System.Xml.XmlConvert]::ToTimeSpan([string]$value).TotalSeconds
}
function Read-Schedule($task) {
  $triggers = @()
  foreach ($trigger in @($task.Triggers)) {
    $kind = switch ([string]$trigger.CimClass.CimClassName) {
      'MSFT_TaskLogonTrigger' { 'logon' }
      'MSFT_TaskTimeTrigger' { 'time' }
      default { 'other' }
    }
    $user = [string]$trigger.UserId
    if ($kind -eq 'logon' -and $user -and -not $user.StartsWith('S-1-')) {
      $user = ([Security.Principal.NTAccount]$user).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    $triggers += @{ kind=$kind; enabled=[bool]$trigger.Enabled; userId=$user;
      startBoundary=[string]$trigger.StartBoundary; endBoundary=[string]$trigger.EndBoundary;
      intervalSeconds=(Schedule-Seconds $trigger.Repetition.Interval);
      durationSeconds=(Schedule-Seconds $trigger.Repetition.Duration);
      stopAtDurationEnd=[bool]$trigger.Repetition.StopAtDurationEnd;
      delaySeconds=(Schedule-Seconds $trigger.Delay); randomDelaySeconds=(Schedule-Seconds $trigger.RandomDelay) }
  }
  return @{ triggers=$triggers; executionTimeLimitSeconds=(Schedule-Seconds $task.Settings.ExecutionTimeLimit);
    startWhenAvailable=[bool]$task.Settings.StartWhenAvailable }
}
function Assert-Schedule($task) {
  $policy = Read-Schedule $task
  $logons = @($policy.triggers | Where-Object { $_.kind -eq 'logon' })
  $times = @($policy.triggers | Where-Object { $_.kind -eq 'time' })
  if ($policy.executionTimeLimitSeconds -ne 1200 -or -not $policy.startWhenAvailable -or
    @($policy.triggers).Count -ne 2 -or $logons.Count -ne 1 -or $times.Count -ne 1) { throw 'Changed task schedule' }
  foreach ($trigger in $policy.triggers) {
    if (-not $trigger.enabled -or $trigger.endBoundary -ne '' -or $trigger.durationSeconds -ne 0 -or
      $trigger.stopAtDurationEnd) { throw 'Changed task schedule' }
  }
  if ($logons[0].userId -cne $d.sid -or $logons[0].intervalSeconds -ne 0 -or $logons[0].delaySeconds -ne 0 -or
    $times[0].intervalSeconds -ne 60 -or $times[0].randomDelaySeconds -ne 0 -or
    [string]::IsNullOrEmpty($times[0].startBoundary)) { throw 'Changed task schedule' }
}
function Task-Time($value) {
  if ($null -eq $value -or $value.Year -lt 2000) { return $null }
  return $value.ToUniversalTime().ToString('o')
}
`;
  const guard = `function Assert-Owned($task) {\n  if ($null -eq $task) { throw 'Task absent' }\n  $s = [string]$task.Principal.UserId\n  if (-not $s.StartsWith('S-1-')) { $s = ([Security.Principal.NTAccount]$s).Translate([Security.Principal.SecurityIdentifier]).Value }\n  if ($task.Description -cne $d.description -or $s -cne $d.sid -or $s -cne (${currentSid})) { throw 'Unmanaged task' }\n  if (@($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ine $d.execute -or $task.Actions[0].Arguments -cne $d.args -or $task.Actions[0].WorkingDirectory -ine $d.project) { throw 'Changed task action' }\n  if ([string]$task.Principal.LogonType -notin @('Interactive','3') -or [string]$task.Principal.RunLevel -notin @('Limited','0') -or [string]$task.Settings.MultipleInstances -notin @('IgnoreNew','2') -or [bool]$task.Settings.WakeToRun) { throw 'Changed task policy' }\n  Assert-Schedule $task\n}\n`;
  if (operation === 'identity') return prefix + `@{sid=(${currentSid})} | ConvertTo-Json -Compress\n`;
  if (operation === 'inspect') return prefix + schedule + inspect + `if ($null -eq $t) { @{exists=$false} | ConvertTo-Json -Compress } else {\n $s=[string]$t.Principal.UserId\n if (-not $s.StartsWith('S-1-')) { $s=([Security.Principal.NTAccount]$s).Translate([Security.Principal.SecurityIdentifier]).Value }\n $policy=Read-Schedule $t\n $info=Get-ScheduledTaskInfo -TaskName $d.name -TaskPath '\\' -ErrorAction Stop\n @{exists=$true;description=$t.Description;sid=$s;execute=$t.Actions[0].Execute;args=$t.Actions[0].Arguments;workingDirectory=$t.Actions[0].WorkingDirectory;state=[string]$t.State;enabled=[bool]$t.Settings.Enabled;logonType=[string]$t.Principal.LogonType;runLevel=[string]$t.Principal.RunLevel;multipleInstances=[string]$t.Settings.MultipleInstances;wakeToRun=[bool]$t.Settings.WakeToRun;actionCount=@($t.Actions).Count;triggers=$policy.triggers;executionTimeLimitSeconds=$policy.executionTimeLimitSeconds;startWhenAvailable=$policy.startWhenAvailable;lastTaskResult=$info.LastTaskResult;lastRunTime=(Task-Time $info.LastRunTime);nextRunTime=(Task-Time $info.NextRunTime);missedRuns=$info.NumberOfMissedRuns} | ConvertTo-Json -Depth 5 -Compress\n}\n`;
  if (operation === 'secureAcl' || operation === 'verifyAcl') {
    const checkDirectory = `$item=Get-Item -LiteralPath $d.directory -Force\nif (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe private directory' }\n`;
    const secure = operation === 'secureAcl' ? `$a = New-Object Security.AccessControl.DirectorySecurity\n$a.SetOwner([Security.Principal.SecurityIdentifier]$d.sid)\n$a.SetAccessRuleProtection($true,$false)\nforeach($s in @($d.sid,'S-1-5-18')) { $identity=[Security.Principal.SecurityIdentifier]$s; $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($rule) }\nSet-Acl -LiteralPath $d.directory -AclObject $a\n` : '';
    return prefix + checkDirectory + secure + `$a=Get-Acl -LiteralPath $d.directory\n$o=$a.Owner\nif (-not $o.StartsWith('S-1-')) { $o=([Security.Principal.NTAccount]$o).Translate([Security.Principal.SecurityIdentifier]).Value }\n$safe=$a.AreAccessRulesProtected -and $o -ceq $d.sid\n$user=$false;$system=$false\n$full=[Security.AccessControl.FileSystemRights]::FullControl\n$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'\nforeach($r in $a.Access) {\n $s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value\n if ($s -notin @($d.sid,'S-1-5-18') -or [string]$r.AccessControlType -ne 'Allow') { $safe=$false }\n $covers=($r.FileSystemRights -band $full) -eq $full -and ($r.InheritanceFlags -band $inherit) -eq $inherit -and [string]$r.PropagationFlags -eq 'None'\n if ($s -eq $d.sid -and $covers) {$user=$true}; if ($s -eq 'S-1-5-18' -and $covers) {$system=$true}\n}\n@{safe=($safe -and $user -and $system)} | ConvertTo-Json -Compress\n`;
  }
  if (operation === 'register') return prefix + schedule + guard + inspect + `if ($null -ne $t) { Assert-Owned $t; Enable-ScheduledTask -TaskName $d.name -TaskPath '\\' | Out-Null } else {\n $a=New-ScheduledTaskAction -Execute $d.execute -Argument $d.args -WorkingDirectory $d.project\n $p=New-ScheduledTaskPrincipal -UserId $d.sid -LogonType Interactive -RunLevel Limited\n $triggers=@((New-ScheduledTaskTrigger -AtLogOn -User $d.sid),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval ([TimeSpan]::FromMinutes(1))))\n $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::FromMinutes(20)) -StartWhenAvailable -WakeToRun:$false\n Register-ScheduledTask -TaskName $d.name -TaskPath '\\' -Action $a -Principal $p -Trigger $triggers -Settings $settings -Description $d.description | Out-Null\n}\n@{ok=$true} | ConvertTo-Json -Compress\n`;
  if (operation === 'start' || operation === 'pause') return prefix + schedule + guard + inspect + `Assert-Owned $t\n${operation === 'start' ? 'Start' : 'Disable'}-ScheduledTask -TaskName $d.name -TaskPath '\\' | Out-Null\n@{ok=$true} | ConvertTo-Json -Compress\n`;
  throw new ZoohausError('Unsupported management operation.');
}

export function createZoohausConnector({ platform = process.platform, pathApi = platform === 'win32' ? path.win32 : path,
  env = process.env, nodePath = process.execPath, scriptPath = SCRIPT_PATH, fs = nativeFs,
  execFile = promisify(nativeExecFile), terminateProcess = terminateCodexProcess,
  signal, setTimer = setTimeout, clearTimer = clearTimeout, cwd = process.cwd() } = {}) {
  const p = pathApi;
  function requireWindows() { if (platform !== 'win32') throw new ZoohausError('Install and management must run on the actual Windows Zoohaus PC.'); }
  async function execute(program, args, options = {}) {
    try { return await execFile(program, args, { env, encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024, ...options, windowsHide: true, shell: false }); }
    catch { throw new ZoohausError('A local prerequisite or management command failed. Check it locally; credential output is never echoed.'); }
  }
  async function runHelper(config) {
    if (signal?.aborted) throw new ZoohausError('The owned task was interrupted before starting.');
    let pending;
    let deadline;
    let forced;
    let interrupted = false;
    let rejectWithoutChild;
    const withoutChild = new Promise((_, reject) => { rejectWithoutChild = reject; });
    const stop = () => {
      if (interrupted) return;
      interrupted = true;
      if (pending?.child) {
        terminateProcess(pending.child, 'SIGTERM', { platform, windowsRoot: env.SystemRoot || env.WINDIR });
        forced = setTimer(() => terminateProcess(pending.child, 'SIGKILL', { platform, windowsRoot: env.SystemRoot || env.WINDIR }), 7_000);
      } else rejectWithoutChild(new ZoohausError('The owned task was interrupted or reached its time limit.'));
    };
    try {
      // Preserve Promise.child: terminate this owned tree while its leader is
      // still alive. Native execFile timeout/AbortSignal would kill only Node.
      pending = execFile(config.node, flags(config, false), { cwd: config.project, env: childEnvironment(config),
        encoding: 'utf8', timeout: 0, maxBuffer: 512 * 1024, windowsHide: true, shell: false });
      signal?.addEventListener('abort', stop, { once: true });
      deadline = setTimer(stop, 1_100_000);
      if (signal?.aborted) stop();
      await Promise.race([pending, withoutChild]);
      if (interrupted) throw new ZoohausError('The owned task was interrupted or reached its time limit.');
    } catch {
      throw new ZoohausError('The owned local job failed or was interrupted. Preserve its state; it will not automatically rerun an uncertain task.');
    } finally {
      clearTimer(deadline); clearTimer(forced);
      signal?.removeEventListener('abort', stop);
    }
  }
  async function ps(operation, data = {}) {
    const root = cleanPath(env.SystemRoot || env.WINDIR || 'C:\\Windows', p);
    const program = p.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = await execute(program, ['-NoProfile', '-NonInteractive', '-Command', powerShellTemplate(operation, data)]);
    try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
    catch { throw new ZoohausError('Windows management returned an unexpected response.'); }
  }
  function fixedConfig(options = {}) {
    const appData = cleanPath(env.LOCALAPPDATA, p);
    const config = p.join(appData, 'vive-codex-bridge', 'zoohaus', 'config.json');
    if (options.config && !samePath(cleanPath(options.config, p), config, p)) throw new ZoohausError('--config must equal the managed LOCALAPPDATA configuration path.');
    return config;
  }
  async function noLinks(filename, allowMissing = false) {
    const chain = [];
    let current = filename;
    while (p.dirname(current) !== current) { chain.unshift(current); current = p.dirname(current); }
    for (const item of chain) {
      try { if ((await fs.lstat(item)).isSymbolicLink()) throw new ZoohausError('A managed path contains a symbolic link or junction; preserving it.'); }
      catch (error) { if (!(allowMissing && error.code === 'ENOENT')) throw error; }
    }
  }
  async function existing(filename, directory = false) {
    const normalized = cleanPath(filename, p);
    await noLinks(normalized);
    const metadata = await fs.lstat(normalized);
    if (directory ? !metadata.isDirectory() : !metadata.isFile()) throw new ZoohausError('A required native executable, runtime file or checkout directory is unavailable.');
    return cleanPath(await fs.realpath(normalized), p);
  }
  async function resolveFuturePath(filename) {
    const missing = [];
    let ancestor = cleanPath(filename, p);
    await noLinks(ancestor, true);
    for (;;) {
      try { await fs.lstat(ancestor); return p.join(cleanPath(await fs.realpath(ancestor), p), ...missing); }
      catch (error) {
        if (error.code !== 'ENOENT' || p.dirname(ancestor) === ancestor) throw error;
        missing.unshift(p.basename(ancestor)); ancestor = p.dirname(ancestor);
      }
    }
  }
  async function outsideProjectAndRuntime(config) {
    const project = await existing(config.project, true);
    const runtime = await existing(config.runtime, true);
    for (const filename of [config.config, config.state]) {
      const resolved = await resolveFuturePath(filename);
      if (inside(project, resolved, p) || inside(runtime, resolved, p)) {
        throw new ZoohausError('Private configuration and state must physically remain outside the checkout and runtime.');
      }
    }
  }
  async function verifyProject(config) {
    const result = await execute(config.git, ['--no-optional-locks', '-C', config.project, 'rev-parse', '--show-toplevel'],
      { cwd: config.project, env: childEnvironment(config) });
    const root = result.stdout.trim();
    if (!root || /[\r\n]/.test(root) || !samePath(await existing(root, true), config.project, p)) {
      throw new ZoohausError('The selected project must be the existing Git checkout root.');
    }
  }
  async function discover(name, explicit) {
    if (explicit) {
      const candidate = cleanPath(explicit, p);
      if (p.basename(candidate).toLowerCase() !== `${name}.exe`) throw new ZoohausError(`Use an absolute native ${name}.exe; command shims are not executed.`);
      return existing(candidate);
    }
    const where = p.join(cleanPath(env.SystemRoot || env.WINDIR || 'C:\\Windows', p), 'System32', 'where.exe');
    const candidates = [];
    try { candidates.push(...(await execute(where, [`${name}.exe`])).stdout.split(/\r?\n/).filter(Boolean)); } catch {}
    if (name === 'codex') {
      const bases = [];
      try { bases.push(...(await execute(where, ['codex.cmd'])).stdout.split(/\r?\n/).filter(Boolean).map(value => p.dirname(value))); } catch {}
      if (env.APPDATA) bases.push(p.join(env.APPDATA, 'npm'));
      const triples = ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'];
      for (const base of [...new Set(bases)]) {
        const packageRoot = p.join(base, 'node_modules', '@openai', 'codex');
        for (const triple of triples) {
          candidates.push(p.join(packageRoot, 'vendor', triple, 'codex', 'codex.exe'));
          for (const arch of ['x64', 'arm64']) {
            candidates.push(p.join(base, 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', triple, 'codex', 'codex.exe'));
            candidates.push(p.join(packageRoot, 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', triple, 'codex', 'codex.exe'));
          }
        }
      }
    }
    for (const candidate of [...new Set(candidates)]) {
      if (p.basename(candidate).toLowerCase() !== `${name}.exe`) continue;
      try { return await existing(candidate); } catch {}
    }
    throw new ZoohausError(`Native ${name}.exe was not found. Supply its absolute path; no executable will be downloaded.`);
  }
  async function identity() {
    const result = await ps('identity');
    if (!sid(result?.sid)) throw new ZoohausError('An interactive current-user Windows SID is required.');
    return result.sid;
  }
  function childEnvironment(config) {
    const result = { ...env };
    const original = env.PATH || env.Path || '';
    for (const key of Object.keys(result)) if (key.toUpperCase() === 'PATH') delete result[key];
    result.PATH = [...new Set([p.dirname(config.codex), p.dirname(config.git), p.dirname(config.node)])].join(';') + (original ? `;${original}` : '');
    result.GIT_TERMINAL_PROMPT = '0';
    return result;
  }
  function flags(config, check) {
    return [config.helper, '--agent', 'cloud', '--allow-from', 'local', '--sandbox', 'read-only', '--state', config.state,
      '--remote', DEFAULT_REMOTE, '--max-messages', '1', '--timeout', '900', check ? '--check' : '--once'];
  }
  function taskData(config) {
    const task = createZoohausPlan(config, { pathApi: p }).task;
    return { name: TASK_NAME, description: OWNER, sid: config.ownerSid, execute: task.action.execute, args: task.action.args, project: config.project };
  }
  function assertOwnedTask(task, config, allowAbsent = false) {
    if (task?.exists === false && allowAbsent) return;
    const expected = taskData(config);
    if (task?.exists !== true || task.description !== OWNER || task.sid !== config.ownerSid
      || !samePath(task.execute, expected.execute, p) || task.args !== expected.args || !samePath(task.workingDirectory, config.project, p)
      || task.actionCount !== 1
      || !['Interactive', '3'].includes(String(task.logonType)) || !['Limited', '0'].includes(String(task.runLevel))
      || !['IgnoreNew', '2'].includes(String(task.multipleInstances)) || task.wakeToRun !== false
      || !validTaskSchedule(task, config.ownerSid)) {
      throw new ZoohausError('Refusing to change a task that is not owned by this user and exact Zoohaus policy.');
    }
  }
  async function checkFiles(config) {
    validateConfig(config, { config: fixedConfig(), connector: cleanPath(scriptPath, p), node: cleanPath(nodePath, p), ownerSid: await identity() }, p);
    for (const name of ['project', 'runtime']) await existing(config[name], true);
    for (const name of ['node', 'codex', 'git', 'connector', 'helper']) await existing(config[name]);
    await noLinks(config.config, true); await noLinks(config.state, true);
    await outsideProjectAndRuntime(config);
    try {
      const state = await fs.lstat(config.state);
      if (!state.isFile()) throw new ZoohausError('Existing private state must be a regular file; preserving it.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async function load(options = {}) {
    requireWindows();
    const filename = fixedConfig(options);
    await noLinks(filename);
    const metadata = await fs.lstat(filename);
    if (!metadata.isFile() || metadata.size > 32_768) throw new ZoohausError('The managed configuration is not a regular bounded JSON file.');
    let config;
    try { config = JSON.parse(await fs.readFile(filename, 'utf8')); } catch { throw new ZoohausError('Unmanaged or invalid configuration; preserving it.'); }
    await checkFiles(config);
    const permission = await ps('verifyAcl', { directory: p.dirname(filename), sid: config.ownerSid });
    if (permission?.safe !== true) throw new ZoohausError('Private Windows ACL could not be verified for current user and SYSTEM only.');
    return config;
  }
  async function makePlan(options = {}) {
    if (platform !== 'win32') return { schema: SCHEMA, platform, supported: false, validated: false,
      notes: ['This connector installs only on the actual Windows Zoohaus PC. No local PC or Windows task was inspected.'] };
    const connector = await existing(cleanPath(scriptPath, p));
    const runtime = p.dirname(p.dirname(connector));
    const project = await existing(options.project || cwd, true);
    const config = { schema: SCHEMA, owner: OWNER, ownerSid: await identity(), project,
      node: await existing(nodePath), codex: await discover('codex', options.codex), git: await discover('git', options.git),
      connector, runtime, helper: p.join(runtime, 'scripts', 'codex-bridge-codex.mjs'), config: fixedConfig(options),
      state: p.join(p.dirname(fixedConfig(options)), 'cloud.codex.json'), remote: DEFAULT_REMOTE,
      agent: 'cloud', allowFrom: ['local'], sandbox: 'read-only', maxMessages: 1, timeout: 900 };
    await existing(config.helper);
    await outsideProjectAndRuntime(config);
    return createZoohausPlan(config, { pathApi: p });
  }
  async function writeConfig(config) {
    const temporary = `${config.config}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      try { await fs.link(temporary, config.config); }
      catch (error) {
        if (error.code === 'EEXIST') throw new ZoohausError('Configuration appeared during installation; preserving it.');
        throw error;
      }
    } finally { await handle?.close().catch(() => {}); await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return {
    plan: makePlan,
    async install(options = {}) {
      requireWindows();
      const plan = await makePlan(options);
      const config = plan.config;
      await noLinks(config.config, true); await noLinks(config.state, true);
      let current;
      try { current = await load(options); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current && CONFIG_KEYS.some(key => JSON.stringify(current[key]) !== JSON.stringify(config[key]))) throw new ZoohausError('Existing installation policy differs. Preserve state; no active configuration will be replaced.');
      const task = await ps('inspect', taskData(config));
      assertOwnedTask(task, config, true);
      await verifyProject(config);
      const check = await execute(config.node, flags(config, true), { cwd: config.project, env: childEnvironment(config), timeout: 150_000 });
      let ready;
      try { ready = JSON.parse(check.stdout.trim()); } catch { throw new ZoohausError('Local helper readiness response is invalid.'); }
      if (ready.status !== 'ready' || ready.inferenceLaunched !== false) throw new ZoohausError('Existing local Git/Codex configuration is not ready. No task was installed.');
      const directory = p.dirname(config.config);
      if (!current) {
        try {
          const entries = await fs.readdir(directory);
          if (entries.length) throw new ZoohausError('The private destination contains unmanaged files; preserving it.');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await fs.mkdir(directory, { recursive: true });
        await noLinks(directory);
        await outsideProjectAndRuntime(config);
        const secured = await ps('secureAcl', { directory, sid: config.ownerSid });
        if (secured?.safe !== true) throw new ZoohausError('Private Windows ACL could not be installed and verified.');
        await writeConfig(config);
      }
      const secured = await ps('verifyAcl', { directory, sid: config.ownerSid });
      if (secured?.safe !== true) throw new ZoohausError('Private Windows ACL could not be verified.');
      const registered = await ps('register', taskData(config));
      if (registered?.ok !== true) throw new ZoohausError('Task registration could not be confirmed.');
      const installed = await ps('inspect', taskData(config));
      assertOwnedTask(installed, config);
      if ((await ps('start', taskData(config)))?.ok !== true) throw new ZoohausError('Owned task start could not be confirmed.');
      return { schema: SCHEMA, installed: true, task: TASK_NAME, role: 'cloud', inferenceVerified: false, localOnly: true };
    },
    async run(options = {}) {
      const config = await load(options);
      assertOwnedTask(await ps('inspect', taskData(config)), config);
      await verifyProject(config);
      await runHelper(config);
      return { schema: SCHEMA, task: TASK_NAME, runCompleted: true, maxMessages: 1 };
    },
    async status(options = {}) {
      const config = await load(options);
      const task = await ps('inspect', taskData(config));
      assertOwnedTask(task, config);
      return { schema: SCHEMA, task: TASK_NAME, enabled: task.enabled === true,
        state: ['Ready', 'Running', 'Disabled', 'Queued'].includes(task.state) ? task.state : 'Unknown',
        scheduleVerified: true, lastTaskResult: Number.isInteger(task.lastTaskResult) && task.lastTaskResult >= 0
          && task.lastTaskResult <= 0xffffffff ? task.lastTaskResult : null,
        lastRunTimeUtc: taskTime(task.lastRunTime), nextRunTimeUtc: taskTime(task.nextRunTime),
        missedRuns: Number.isInteger(task.missedRuns) && task.missedRuns >= 0 ? task.missedRuns : null,
        inferenceVerified: false };
    },
    async pause(options = {}) {
      const config = await load(options);
      assertOwnedTask(await ps('inspect', taskData(config)), config);
      if ((await ps('pause', taskData(config)))?.ok !== true) throw new ZoohausError('Owned task pause could not be confirmed.');
      return { schema: SCHEMA, task: TASK_NAME, paused: true, runningJobMayFinish: true };
    },
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseZoohausArgs(argv, { cwd: dependencies.cwd || process.cwd() });
  if (options.help) { process.stdout.write(HELP); return; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (options.mode === 'run') { process.on('SIGINT', stop); process.on('SIGTERM', stop); }
  try {
    const connector = createZoohausConnector({ signal: controller.signal, ...dependencies });
    const result = await connector[options.mode](options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    if (options.mode === 'run') { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`codex-bridge-zoohaus: ${error instanceof ZoohausError ? error.message : 'Connector failed. Preserve local files and inspect prerequisites on Zoohaus.'}\n`);
    process.exitCode = 1;
  });
}
