#!/usr/bin/env node
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { validateRemote } from './codex-bridge.mjs';

const execFileAsync = promisify(execFile);
const MARKER = 'Managed by vive-codex-bridge-service/v1';
const HELP = `Usage: node scripts/codex-bridge-service.mjs --project /ABS/REPO --node /ABS/node --codex /ABS/codex --allow-from cloud [options]

  --plan              Print a JSON installation plan without writing files (default)
  --install           Validate existing Git/Codex access, install and enable a user service
  --project PATH      Absolute project checkout; required
  --node PATH         Absolute Node executable; required
  --codex PATH        Absolute Codex executable named codex (Windows: codex.exe); required
  --agent NAME        Inbox agent (default: local)
  --allow-from NAME   Explicit trusted sender; repeat for additional senders; required
  --state PATH        Absolute state path outside the checkout (default: user state directory)
  --remote URL|PATH   Optional private mailbox override; credentials must not be in the URL
  --interval SECONDS  Schedule interval (default: 60; minimum: 30)
  --timeout SECONDS   Codex task limit (default: 900; range: 10..900)
  --platform NAME     linux, darwin, or win32; cross-platform preview only
  --help              Show this help

The service processes at most one message per run in the read-only sandbox.
It uses your existing Codex login. Never put API keys in service arguments.
Install on the local computer: cloud plans do not configure that computer.
`;

function validAgent(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/.test(value) && value !== 'all';
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function cleanPath(value, flag) {
  if (!value || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${flag} requires an absolute path without control characters.`);
  return path.normalize(value);
}

export function parseServiceArgs(argv, { home = homedir(), platform = process.platform } = {}) {
  const options = { agent: 'local', allowFrom: [], interval: 60, timeout: 900, install: false, platform, home };
  let explicitPlan = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    if (['--plan', '--install', '--help'].includes(flag)) {
      if (equals >= 0) throw new Error(`${flag} does not accept a value.`);
      if (flag === '--plan') explicitPlan = true;
      else options[flag.slice(2)] = true;
      continue;
    }
    if (!['--project', '--node', '--codex', '--agent', '--allow-from', '--state', '--remote', '--interval', '--timeout', '--platform'].includes(flag)) {
      throw new Error('Unknown option. See --help.');
    }
    const value = equals < 0 ? argv[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--allow-from') options.allowFrom.push(value);
    else options[flag.slice(2)] = ['--interval', '--timeout'].includes(flag) ? Number(value) : value;
  }
  if (options.help) return options;
  if (explicitPlan && options.install) throw new Error('Use either --plan or --install.');
  if (!validAgent(options.agent) || !options.allowFrom.length || options.allowFrom.some(sender => !validAgent(sender))) {
    throw new Error('A valid agent and at least one explicit --allow-from sender are required; wildcards are not supported.');
  }
  options.allowFrom = [...new Set(options.allowFrom)];
  for (const name of ['project', 'node', 'codex']) options[name] = cleanPath(options[name], `--${name}`);
  if (!['codex', ...(options.platform === 'win32' ? ['codex.exe'] : [])].includes(path.basename(options.codex))) {
    throw new Error('--codex must point to the executable named codex (Windows: codex.exe); its directory is added to the service PATH.');
  }
  if (options.platform !== 'win32' && [options.node, options.codex].some(filename => path.dirname(filename).includes(':'))) throw new Error('Executable directories must not contain a PATH separator (:).');
  options.state = cleanPath(options.state ?? path.join(home, '.local', 'state', 'vive-codex-bridge', `codex-${options.agent}.json`), '--state');
  if (inside(options.project, options.state)) throw new Error('--state must be outside the project checkout.');
  if (!Number.isInteger(options.interval) || options.interval < 30 || options.interval > 86_400) throw new Error('--interval must be an integer between 30 and 86400 seconds.');
  if (!Number.isInteger(options.timeout) || options.timeout < 10 || options.timeout > 900) throw new Error('--timeout must be an integer between 10 and 900 seconds.');
  if (!['linux', 'darwin', 'win32'].includes(options.platform)) throw new Error('Supported previews are linux, darwin, and win32.');
  if (options.platform === 'linux' && (/[\s\\]$/.test(options.project))) throw new Error('Linux WorkingDirectory paths cannot end in whitespace or a backslash.');
  if (options.install && options.platform !== platform) throw new Error('Cross-platform preview cannot be installed on this computer.');
  if (options.remote && (/[\u0000-\u001f\u007f]/.test(options.remote) || /^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(options.remote))) {
    throw new Error('--remote must not contain URL credentials or control characters; use existing Git authentication.');
  }
  if (options.remote) {
    validateRemote(options.remote);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(options.remote)) {
      const remoteUrl = new URL(options.remote);
      if (remoteUrl.search || remoteUrl.hash) throw new Error('Mailbox service URLs must not contain query parameters or fragments.');
    }
  }
  return options;
}

function systemdQuote(value, expandEnvironment = false) {
  let escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  if (expandEnvironment) escaped = escaped.replaceAll('$', () => '$$');
  return `"${escaped}"`;
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function command(executable, args, extra = {}) {
  return { executable, args, ...extra };
}

export function createServicePlan(options, { uid = process.getuid?.() ?? 'UID' } = {}) {
  const launcher = path.join(options.project, 'scripts', 'codex-bridge-codex.mjs');
  const flags = ['--agent', options.agent, ...options.allowFrom.flatMap(sender => ['--allow-from', sender]),
    '--sandbox', 'read-only', '--state', options.state, '--max-messages', '1', '--timeout', String(options.timeout)];
  if (options.remote) flags.push('--remote', options.remote);
  const args = [launcher, ...flags, '--once'];
  const executableDirectories = options.platform === 'win32'
    ? [path.dirname(options.codex), path.dirname(options.node)]
    : [path.dirname(options.codex), path.dirname(options.node), '/usr/local/bin', '/usr/bin', '/bin'];
  const executionPath = [...new Set(executableDirectories)].join(options.platform === 'win32' ? ';' : ':');
  const check = command(options.node, [launcher, ...flags, '--check'], { cwd: options.project, environment: { PATH: executionPath } });
  // Hex keeps agent names containing "--" valid inside an XML comment.
  const marker = `${MARKER}; agent-hex=${Buffer.from(options.agent).toString('hex')}`;
  const plan = {
    schema: 'codex-bridge-service/v1', platform: options.platform, validated: false,
    agent: options.agent, allowFrom: options.allowFrom, sandbox: 'read-only',
    files: [], commands: { check },
    notes: [
      'This preview writes no files and has not verified local Git or Codex authentication.',
      'The computer must be running. A user service normally starts when you log in.',
      'Existing noninteractive Git authentication and Codex CLI login are required; credentials are never saved in service files.',
      'One message per run, read-only sandbox, no automatic retry of failed Codex tasks.',
      'Sender labels are routing metadata, not authenticated identities. Trust every writer of the private mailbox. This does not wake a web chat.',
    ],
    directories: [path.dirname(options.state)],
  };
  if (options.platform === 'linux') {
    const name = `vive-codex-bridge-${options.agent}`;
    const directory = path.join(options.home, '.config', 'systemd', 'user');
    const service = `${name}.service`;
    const timer = `${name}.timer`;
    const serviceContent = `# ${marker}\n[Unit]\nDescription=VIVE Codex bridge (${options.agent})\n\n[Service]\nType=oneshot\nWorkingDirectory=${options.project.replaceAll('%', '%%')}\nEnvironment=${systemdQuote(`PATH=${executionPath}`)}\nExecStart=${[options.node, ...args].map(value => systemdQuote(value, true)).join(' ')}\nUMask=0077\nTimeoutStartSec=${options.timeout + 300}\n`;
    const timerContent = `# ${marker}\n[Unit]\nDescription=Poll VIVE Codex bridge (${options.agent})\n\n[Timer]\nOnStartupSec=30s\nOnUnitInactiveSec=${options.interval}s\nAccuracySec=5s\nUnit=${service}\n\n[Install]\nWantedBy=timers.target\n`;
    plan.files = [{ path: path.join(directory, service), content: serviceContent, mode: '0600' }, { path: path.join(directory, timer), content: timerContent, mode: '0600' }];
    Object.assign(plan.commands, {
      reload: command('systemctl', ['--user', 'daemon-reload']),
      start: command('systemctl', ['--user', 'enable', '--now', timer]),
      status: command('systemctl', ['--user', 'status', timer, service]),
      logs: command('journalctl', ['--user', '-u', service]),
      pause: command('systemctl', ['--user', 'stop', timer]),
      resume: command('systemctl', ['--user', 'start', timer]),
      disable: command('systemctl', ['--user', 'disable', '--now', timer]),
    });
    plan.notes.push('Boot operation without login requires a user manager configured for lingering; this installer does not change system login settings.');
  } else if (options.platform === 'darwin') {
    const label = `mx.vivedeutsch.codex-bridge.${options.agent}`;
    const filename = path.join(options.home, 'Library', 'LaunchAgents', `${label}.plist`);
    const logDirectory = path.dirname(options.state);
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<!-- ${marker} -->\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${[options.node, ...args].map(value => `<string>${xml(value)}</string>`).join('')}</array>\n<key>WorkingDirectory</key><string>${xml(options.project)}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(executionPath)}</string></dict>\n<key>RunAtLoad</key><true/>\n<key>StartInterval</key><integer>${options.interval}</integer>\n<key>Umask</key><integer>63</integer>\n<key>StandardOutPath</key><string>${xml(path.join(logDirectory, `service-${options.agent}.out.log`))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(logDirectory, `service-${options.agent}.err.log`))}</string>\n</dict></plist>\n`;
    plan.files = [{ path: filename, content, mode: '0600' }];
    const target = `gui/${uid}/${label}`;
    Object.assign(plan.commands, {
      enable: command('launchctl', ['enable', target]),
      start: command('launchctl', ['bootstrap', `gui/${uid}`, filename]),
      status: command('launchctl', ['print', target]),
      pause: command('launchctl', ['bootout', target]),
      resume: command('launchctl', ['bootstrap', `gui/${uid}`, filename]),
      disable: command('launchctl', ['disable', target]),
    });
    plan.notes.push('This LaunchAgent starts at login and does not run while the user is logged out. Pause before changing an active installation.');
  } else {
    plan.commands.manual = command(options.node, args, { cwd: options.project, environment: { PATH: executionPath } });
    plan.notes.push('Windows installation is unsupported. Configure Task Scheduler manually with the absolute program, arguments, working directory, login account, Git on PATH and a recurring trigger.');
  }
  if (plan.files.some(file => inside(options.project, file.path))) throw new Error('User service files must be outside the project checkout.');
  plan.remove = { first: 'Disable the schedule, then remove only the listed owned files. Keep task state unless deliberately resetting message history.', files: plan.files.map(file => file.path) };
  return plan;
}

async function run(commandSpec, { timeout = 150_000, maxBuffer = 40 * 1024 * 1024 } = {}) {
  return execFileAsync(commandSpec.executable, commandSpec.args, {
    cwd: commandSpec.cwd, env: { ...process.env, ...commandSpec.environment, GIT_TERMINAL_PROMPT: '0' }, timeout, maxBuffer,
  });
}

async function inspectOwnedFiles(plan) {
  const changes = [];
  for (const file of plan.files) {
    let current;
    try {
      const metadata = await fs.lstat(file.path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error(`Refusing to replace an unexpected file at ${file.path}.`);
      current = await fs.readFile(file.path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const marker = `${MARKER}; agent-hex=${Buffer.from(plan.agent).toString('hex')}`;
    const owned = current?.startsWith(`# ${marker}\n`) || current?.split('\n')[2] === `<!-- ${marker} -->`;
    if (current !== undefined && !owned) throw new Error(`Refusing to overwrite an unmanaged file at ${file.path}.`);
    changes.push({ ...file, changed: current !== file.content, previous: current });
  }
  return changes;
}

async function writeOwnedFile(file) {
  await fs.mkdir(path.dirname(file.path), { recursive: true, mode: 0o700 });
  if (!file.changed) {
    const handle = await fs.open(file.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > 128 * 1024 || (await handle.readFile('utf8')) !== file.previous) {
        throw new Error(`Service file changed during installation at ${file.path}; preserving it.`);
      }
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    return;
  }
  const temporary = `${file.path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, file.content, { flag: 'wx', mode: 0o600 });
    if (file.previous === undefined) await fs.link(temporary, file.path);
    else {
      if ((await fs.readFile(file.path, 'utf8')) !== file.previous) throw new Error(`Service file changed during installation at ${file.path}; preserving it.`);
      await fs.rename(temporary, file.path);
    }
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function resolveFuturePath(filename) {
  let existing = filename;
  const missing = [];
  while (true) {
    try {
      return path.join(await fs.realpath(existing), ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

export async function installService(options, plan = createServicePlan(options), dependencies = {}) {
  const execute = dependencies.runCommand ?? run;
  if (!['linux', 'darwin'].includes(options.platform)) throw new Error('Automatic installation is supported only on Linux and macOS; use the plan for a manual schedule.');
  if (options.platform !== process.platform) throw new Error('The installation platform must match this computer.');
  // Check every destination before running readiness checks or touching any files.
  const files = await inspectOwnedFiles(plan);
  for (const executable of [options.node, options.codex]) await fs.access(executable, fs.constants.X_OK);
  if (!(await fs.stat(options.project)).isDirectory()) throw new Error('--project must be an existing checkout directory.');
  const actualProject = await fs.realpath(options.project);
  for (const destination of [options.state, ...plan.files.map(file => file.path)]) {
    if (inside(actualProject, await resolveFuturePath(destination))) throw new Error('A service or state path resolves inside the project checkout.');
  }
  const version = await execute(command(options.node, ['--version']), { timeout: 10_000, maxBuffer: 4096 });
  if (!/^v(?:2[2-9]|[3-9]\d)\./.test(version.stdout.trim())) throw new Error('Node 22 or newer is required.');
  await execute(plan.commands.check);
  const inboxArgs = [path.join(options.project, 'scripts', 'codex-bridge.mjs'), 'inbox', '--agent', options.agent, '--json'];
  if (options.remote) inboxArgs.push('--remote', options.remote);
  await execute(command(options.node, inboxArgs, { cwd: options.project, environment: plan.commands.check.environment }));
  if (options.platform === 'linux') await execute(command('systemctl', ['--user', 'show', '--property=Version', '--value']), { timeout: 10_000, maxBuffer: 4096 });
  for (const directory of plan.directories) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (options.platform === 'darwin') {
    const loaded = await execute(plan.commands.status, { timeout: 10_000 }).then(() => true, () => false);
    if (loaded && files.some(file => file.changed)) throw new Error('The macOS service is active. Pause it using the plan command, then rerun --install to apply changes.');
    for (const file of files) await writeOwnedFile(file);
    await execute(plan.commands.enable, { timeout: 10_000 });
    if (!loaded) await execute(plan.commands.start, { timeout: 10_000 });
  } else {
    for (const file of files) await writeOwnedFile(file);
    await execute(plan.commands.reload, { timeout: 10_000 });
    await execute(plan.commands.start, { timeout: 10_000 });
  }
  return { ...plan, validated: true, installed: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseServiceArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else {
      const plan = createServicePlan(options);
      const result = options.install ? await installService(options, plan) : plan;
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    // Child output may contain private task content or credentials; do not echo it.
    const detail = error.cmd ? `Readiness or service command failed (exit ${error.code ?? 'unknown'}). Run the plan's check/status commands locally for details.` : error.message;
    process.stderr.write(`codex-bridge-service: ${detail}\n`);
    process.exitCode = 1;
  }
}
