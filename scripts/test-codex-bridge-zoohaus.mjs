import assert from 'node:assert/strict';
import path from 'node:path';
import { createZoohausConnector, parseZoohausArgs } from './codex-bridge-zoohaus.mjs';

// All files, native executables and PowerShell calls are fixtures. No Windows operation,
// Scheduled Task, network request or Codex inference is executed by this suite.
const win = path.win32;
const sid = 'S-1-5-21-100-200-300-1001';
const differentSid = 'S-1-5-21-100-200-300-1002';
const project = 'C:\\Users\\Alice Zoo\\Work & Play (100); VIVE MX';
const localAppData = 'C:\\Users\\Alice Zoo\\AppData\\Local';
const node = 'C:\\Program Files\\nodejs\\node.exe';
const codex = 'C:\\Users\\Alice Zoo\\Tools & Native\\codex.exe';
const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
const connector = win.join(project, 'scripts', 'codex-bridge-zoohaus.mjs');
const helper = win.join(project, 'scripts', 'codex-bridge-codex.mjs');
const configPath = win.join(localAppData, 'vive-codex-bridge', 'zoohaus', 'config.json');
const statePath = win.join(win.dirname(configPath), 'cloud.codex.json');
const environment = {
  LOCALAPPDATA: localAppData, APPDATA: 'C:\\Users\\Alice Zoo\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\Alice Zoo', SystemRoot: 'C:\\Windows',
  PATH: 'C:\\Windows\\System32;C:\\Other Tools',
};
const taskName = 'VIVE-Codex-Bridge-Zoohaus';
const owner = 'Managed by vive-codex-bridge-zoohaus/v1';
let passed = 0;

function schedule() {
  return { executionTimeLimitSeconds: 1_200, startWhenAvailable: true,
    triggers: [
      { kind: 'logon', userId: sid, enabled: true, startBoundary: '', endBoundary: '',
        intervalSeconds: 0, durationSeconds: 0, stopAtDurationEnd: false, delaySeconds: 0, randomDelaySeconds: 0 },
      { kind: 'time', userId: '', enabled: true, startBoundary: '2026-10-13T10:00:00', endBoundary: '',
        intervalSeconds: 60, durationSeconds: 0, stopAtDurationEnd: false, delaySeconds: 0, randomDelaySeconds: 0 },
    ], lastTaskResult: 0, lastRunTime: '2026-10-13T10:00:00.0000000Z', nextRunTime: '2026-10-13T10:01:00.0000000Z', missedRuns: 0 };
}

function failure(code) { return Object.assign(new Error(code), { code }); }

class MemoryFiles {
  constructor() { this.entries = new Map(); this.mutations = []; this.realpaths = new Map(); this.beforeLink = null; }
  key(filename) { return win.resolve(filename).toLowerCase(); }
  putDirectory(filename) {
    const resolved = win.resolve(filename);
    if (win.dirname(resolved) !== resolved) this.putDirectory(win.dirname(resolved));
    this.entries.set(this.key(resolved), { kind: 'directory', filename: resolved });
  }
  putFile(filename, content = '') {
    this.putDirectory(win.dirname(filename));
    this.entries.set(this.key(filename), { kind: 'file', filename: win.resolve(filename), content: Buffer.from(content) });
  }
  putSymlink(filename, target) {
    this.putDirectory(win.dirname(filename));
    this.entries.set(this.key(filename), { kind: 'symlink', filename: win.resolve(filename), target });
  }
  entry(filename) {
    const result = this.entries.get(this.key(filename));
    if (!result) throw failure('ENOENT');
    return result;
  }
  statistics(entry) {
    return { size: entry.content?.length || 0, dev: 1, ino: 1,
      isFile: () => entry.kind === 'file', isDirectory: () => entry.kind === 'directory',
      isSymbolicLink: () => entry.kind === 'symlink' };
  }
  lstat = async filename => this.statistics(this.entry(filename));
  stat = async filename => this.statistics(this.entry(filename));
  realpath = async filename => {
    const entry = this.entry(filename);
    if (this.realpaths.has(this.key(filename))) return this.realpaths.get(this.key(filename));
    return entry.kind === 'symlink' ? entry.target : entry.filename;
  };
  access = async filename => { this.entry(filename); };
  readFile = async (filename, encoding) => {
    const entry = this.entry(filename);
    if (entry.kind !== 'file') throw failure('EINVAL');
    return encoding ? entry.content.toString(typeof encoding === 'string' ? encoding : encoding.encoding) : Buffer.from(entry.content);
  };
  mkdir = async filename => { this.mutations.push({ operation: 'mkdir', filename }); this.putDirectory(filename); };
  writeFile = async (filename, content) => { this.mutations.push({ operation: 'writeFile', filename }); this.putFile(filename, content); };
  open = async (filename, flags) => {
    const write = typeof flags === 'string' && /[wa]/.test(flags);
    if (write && flags.includes('x') && this.entries.has(this.key(filename))) throw failure('EEXIST');
    if (write) { this.mutations.push({ operation: 'open', filename }); this.putFile(filename); }
    const entry = this.entry(filename);
    return { writeFile: async content => { entry.content = Buffer.from(content); },
      readFile: async encoding => encoding ? entry.content.toString(encoding) : Buffer.from(entry.content),
      stat: async () => this.statistics(entry), sync: async () => {}, close: async () => {}, chmod: async () => {} };
  };
  rename = async (source, destination) => {
    this.mutations.push({ operation: 'rename', source, destination });
    const entry = this.entry(source);
    this.entries.delete(this.key(source));
    entry.filename = win.resolve(destination);
    this.entries.set(this.key(destination), entry);
  };
  link = async (source, destination) => {
    await this.beforeLink?.(source, destination);
    if (this.entries.has(this.key(destination))) throw failure('EEXIST');
    const entry = this.entry(source);
    if (entry.kind !== 'file') throw failure('EPERM');
    this.mutations.push({ operation: 'link', source, destination });
    this.entries.set(this.key(destination), { ...entry, filename: win.resolve(destination) });
  };
  unlink = async filename => {
    this.entry(filename); this.mutations.push({ operation: 'unlink', filename }); this.entries.delete(this.key(filename));
  };
  readdir = async (dirname, options) => {
    this.entry(dirname);
    const entries = [...this.entries.values()].filter(entry => win.dirname(entry.filename).toLowerCase() === this.key(dirname));
    return entries.map(entry => options?.withFileTypes ? {
      name: win.basename(entry.filename), isFile: () => entry.kind === 'file',
      isDirectory: () => entry.kind === 'directory', isSymbolicLink: () => entry.kind === 'symlink',
    } : win.basename(entry.filename));
  };
}

function decodedPayload(script) {
  const literal = /FromBase64String\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/.exec(script)?.[1];
  if (literal) return JSON.parse(Buffer.from(literal, 'base64').toString('utf8'));
  for (const match of script.matchAll(/['"]([A-Za-z0-9+/]{40,}={0,2})['"]/g)) {
    try { return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch {}
  }
  assert.fail('PowerShell did not receive a separately encoded JSON payload');
}

// Interpret Windows C-runtime quoting independently of the connector's encoder.
function windowsArguments(commandLine) {
  const result = [];
  let index = 0;
  while (index < commandLine.length) {
    while (/\s/.test(commandLine[index] || '') && index < commandLine.length) index++;
    if (index === commandLine.length) break;
    let argument = '';
    let quoted = false;
    while (index < commandLine.length) {
      if (!quoted && /\s/.test(commandLine[index])) break;
      if (commandLine[index] === '\\') {
        let count = 0;
        while (commandLine[index] === '\\') { count++; index++; }
        if (commandLine[index] === '"') {
          argument += '\\'.repeat(Math.floor(count / 2));
          if (count % 2) argument += '"'; else quoted = !quoted;
          index++;
        } else argument += '\\'.repeat(count);
      } else if (commandLine[index] === '"') { quoted = !quoted; index++; }
      else argument += commandLine[index++];
    }
    assert.equal(quoted, false, 'Unclosed scheduler argument quote');
    result.push(argument);
  }
  return result;
}

function fixture({ platform = 'win32', dependencies = {} } = {}) {
  const fs = new MemoryFiles();
  fs.putDirectory(project);
  fs.putDirectory(win.join(project, '.git'));
  fs.putDirectory(localAppData);
  for (const filename of [node, codex, git, connector, helper]) fs.putFile(filename, 'Fixture native executable or helper');
  const calls = [];
  const behavior = { currentSid: sid, task: null, safeAcl: true, ready: true, nativeDiscovery: codex, gitRoot: project, workerPromise: null };
  const respondToExecution = async (program, args, options = {}) => {
    assert.notEqual(options.shell, true, 'Shell execution is forbidden');
    assert.equal(options.windowsHide, true, 'Native management and helper children must hide their console windows');
    calls.push({ program, args, options });
    const executable = win.basename(program).toLowerCase();
    if (executable === 'where.exe') return { stdout: `${behavior.nativeDiscovery}\r\n`, stderr: '' };
    if (executable === 'powershell.exe' || executable === 'pwsh.exe') {
      assert.ok(args.includes('-NoProfile'));
      assert.ok(args.includes('-NonInteractive'));
      const script = args[args.indexOf('-Command') + 1];
      const op = /#\s*vive-zoohaus:\s*([a-zA-Z]+)/.exec(script)?.[1];
      assert.ok(op, 'Unknown PowerShell operation');
      const payload = decodedPayload(script);
      calls.at(-1).operation = op;
      calls.at(-1).payload = payload;
      assert.ok(!script.includes(project), 'User-controlled path was interpolated into PowerShell syntax');
      let value;
      if (op === 'identity') value = { sid: behavior.currentSid };
      else if (op === 'inspect') {
        assert.match(script, /Read-Schedule \$t/);
        assert.match(script, /Get-ScheduledTaskInfo -TaskName \$d\.name/);
        assert.match(script, /-Depth 5/);
        value = behavior.task || { exists: false };
      }
      else if (op === 'verifyAcl') value = { safe: behavior.safeAcl };
      else if (op === 'secureAcl') {
        assert.equal(payload.directory, win.dirname(configPath), 'ACL update escaped the managed private directory');
        assert.equal(payload.sid, behavior.currentSid);
        assert.match(script, /SetAccessRuleProtection\(\s*\$true\s*,\s*\$false\s*\)/);
        const literalSids = [...script.matchAll(/['"](S-1-[0-9-]+)['"]/g)].map(match => match[1]);
        assert.ok(literalSids.every(value => value === 'S-1-5-18'), 'ACL code grants access beyond the user and SYSTEM');
        value = { safe: true };
      }
      else if (op === 'register') {
        assert.equal(payload.name, taskName);
        assert.equal(payload.sid, behavior.currentSid);
        assert.match(script, /-UserId\s+\$d\.sid/);
        assert.match(script, /New-ScheduledTaskTrigger\s+-AtLogOn\s+-User\s+\$d\.sid/);
        assert.match(script, /-RepetitionInterval\s+\(\[TimeSpan\]::FromMinutes\(1\)\)/);
        assert.match(script, /Assert-Schedule \$task/);
        assert.match(script, /executionTimeLimitSeconds -ne 1200/);
        assert.match(script, /\$times\[0\]\.intervalSeconds -ne 60/);
        behavior.task = { exists: true, description: payload.description, sid: payload.sid,
          execute: payload.execute, args: payload.args, workingDirectory: payload.project,
          state: 'Ready', enabled: true, actionCount: 1,
          logonType: /-LogonType\s+([a-zA-Z]+)/.exec(script)?.[1],
          runLevel: /-RunLevel\s+([a-zA-Z]+)/.exec(script)?.[1],
          multipleInstances: /-MultipleInstances\s+([a-zA-Z]+)/.exec(script)?.[1], wakeToRun: false, ...schedule() };
        value = { ok: true };
      } else if (['start', 'pause'].includes(op)) {
        assert.match(script, /Assert-Schedule \$task/);
        value = { ok: true };
      }
      else assert.fail(`Unexpected PowerShell fixture operation: ${op}`);
      return { stdout: JSON.stringify(value), stderr: '' };
    }
    if (executable === 'node.exe') {
      return { stdout: JSON.stringify({ status: behavior.ready ? 'ready' : 'blocked', configuration: {}, transport: {}, inferenceLaunched: false }), stderr: '' };
    }
    if (executable === 'git.exe') {
      if (args.includes('rev-parse') && args.includes('--show-toplevel')) {
        return { stdout: `${behavior.gitRoot.replace(/\\/g, '/')}\n`, stderr: '' };
      }
      return { stdout: 'git version 2.47.0.windows.1\n', stderr: '' };
    }
    assert.fail(`Unexpected executable fixture: ${executable}`);
  };
  const execFile = (program, args, options = {}) => {
    if (win.basename(program).toLowerCase() === 'node.exe' && args.includes('--once') && behavior.workerPromise) {
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      calls.push({ program, args, options });
      return behavior.workerPromise;
    }
    return respondToExecution(program, args, options);
  };
  const client = createZoohausConnector({ platform, pathApi: win, env: environment, nodePath: node,
    scriptPath: connector, fs, execFile, cwd: project, ...dependencies });
  return { fs, calls, behavior, client };
}

function options(mode, extra = []) {
  return parseZoohausArgs([...(mode ? [`--${mode}`] : []), '--project', project, '--codex', codex, '--git', git, ...extra], { cwd: project, pathApi: win });
}

function taskOperations(fixture, ...names) { return fixture.calls.filter(call => names.includes(call.operation)); }
async function config(fixture) { return JSON.parse(await fixture.fs.readFile(configPath, 'utf8')); }
function ownedTask(configuration, plan) {
  return { exists: true, description: owner, sid: configuration.ownerSid,
    execute: configuration.node, args: plan.task.action.args, workingDirectory: configuration.project,
    state: 'Ready', enabled: true, actionCount: 1, logonType: 'Interactive', runLevel: 'Limited',
    multipleInstances: 'IgnoreNew', wakeToRun: false, ...schedule() };
}
async function rejects(run, pattern) {
  await assert.rejects(run, error => pattern.test(error.message));
}
async function test(name, run) { await run(); passed++; console.log(`PASS: ${name}`); }

await test('the default plan previews fixed policy and performs no filesystem or scheduler mutations', async () => {
  const f = fixture();
  const parsed = parseZoohausArgs([], { cwd: project, pathApi: win });
  assert.equal(parsed.mode, 'plan');
  const plan = await f.client.plan(options());
  assert.equal(plan.task.name, taskName);
  assert.equal(plan.config.agent, 'cloud');
  assert.deepEqual(plan.config.allowFrom, ['local']);
  assert.equal(plan.config.sandbox, 'read-only');
  assert.equal(plan.config.maxMessages, 1);
  assert.equal(plan.config.remote, 'https://github.com/RalRue/VIVEDEUTSCHMX-CODEX-BRIDGE.git');
  assert.equal(f.fs.mutations.length, 0);
  assert.equal(taskOperations(f, 'register', 'start', 'pause', 'secureAcl').length, 0);
});

await test('installation refuses a non-Windows platform before any mutation', async () => {
  const f = fixture({ platform: 'linux' });
  await rejects(() => f.client.install(options('install')), /Windows|platform|win32/i);
  assert.equal(f.fs.mutations.length, 0);
  assert.equal(taskOperations(f, 'register', 'start', 'secureAcl').length, 0);
});

await test('native executable discovery refuses codex.cmd and parser rejects dangerous policy overrides', async () => {
  const f = fixture();
  f.behavior.nativeDiscovery = 'C:\\Users\\Alice Zoo\\AppData\\Roaming\\npm\\codex.cmd';
  await rejects(() => f.client.install(parseZoohausArgs(['--install', '--project', project, '--git', git], { cwd: project, pathApi: win })), /codex|native|exe|discover/i);
  assert.equal(taskOperations(f, 'register').length, 0);
  for (const args of [
    ['--install', '--run'], ['--remote', 'https://example.invalid/public.git'],
    ['--sandbox', 'danger-full-access'], ['--allow-from', '*'], ['--retry-failed'],
  ]) assert.throws(() => parseZoohausArgs(args, { cwd: project, pathApi: win }), /option|mode|path|absolute|invalid|unknown|project/i);
  for (const projectPath of ['C:\\Bad"; injection', '..\\relative', 'C:\\Project%EXPANSION%']) {
    await rejects(() => f.client.plan({ ...options(), project: projectPath }), /path|absolute|quote|expansion|invalid/i);
  }
});

await test('a failed native readiness check prevents config writes and registration', async () => {
  const f = fixture();
  f.behavior.ready = false;
  await rejects(() => f.client.install(options('install')), /ready|check|blocked|configuration/i);
  assert.equal(f.fs.mutations.length, 0);
  assert.equal(taskOperations(f, 'secureAcl', 'register', 'start').length, 0);
});

await test('installation records one current-user Limited Interactive task with logon/minute triggers', async () => {
  const f = fixture();
  const plan = await f.client.plan(options());
  assert.equal((await f.client.install(options('install'))).installed, true);
  const saved = await config(f);
  assert.equal(saved.schema, 'codex-bridge-zoohaus/v1');
  assert.equal(saved.owner, owner);
  assert.equal(saved.ownerSid, sid);
  assert.equal(saved.project, project);
  assert.equal(saved.node, node);
  assert.equal(saved.codex, codex);
  assert.equal(saved.git, git);
  assert.equal(saved.state, statePath);
  assert.equal(plan.task.principal.userId, sid);
  assert.equal(plan.task.principal.logonType, 'Interactive');
  assert.equal(plan.task.principal.runLevel, 'Limited');
  assert.deepEqual(plan.task.triggers, ['logon', 'every-minute']);
  assert.equal(plan.task.settings.multipleInstances, 'IgnoreNew');
  assert.equal(taskOperations(f, 'register').length, 1);
  const registration = taskOperations(f, 'register')[0];
  assert.ok(registration.payload);
  assert.equal(plan.task.action.execute, node);
  assert.equal(plan.task.action.workingDirectory, project);
  assert.ok(plan.task.action.args.includes('"'));
  assert.ok(plan.task.action.args.includes('--run'));
  assert.deepEqual(windowsArguments(plan.task.action.args), [connector, '--run', '--config', configPath]);
  assert.ok(!plan.task.action.args.includes('--retry-failed'));
  assert.ok(!plan.task.action.args.includes('--worktree'));
  assert.equal(taskOperations(f, 'secureAcl').length > 0, true);
  for (const acl of taskOperations(f, 'secureAcl')) {
    assert.ok(!JSON.stringify(acl.payload).includes('Everyone'));
    assert.ok(!JSON.stringify(acl.payload).includes('Builtin\\Users'));
  }
});

await test('unknown scheduled tasks and unmarked config files are never overwritten', async () => {
  const unknown = fixture();
  unknown.behavior.task = { exists: true, description: 'Another application task', sid, execute: node, args: 'unrelated', workingDirectory: project };
  await rejects(() => unknown.client.install(options('install')), /task|owned|managed|unknown|refuse/i);
  assert.equal(unknown.fs.mutations.length, 0);
  assert.equal(taskOperations(unknown, 'register', 'secureAcl').length, 0);
  const unmarked = fixture();
  unmarked.fs.putFile(configPath, '{"userData":"preserve me"}');
  await rejects(() => unmarked.client.install(options('install')), /config|owned|managed|invalid/i);
  assert.equal(unmarked.fs.mutations.length, 0);
  assert.equal(taskOperations(unmarked, 'register', 'secureAcl').length, 0);
  assert.equal(await unmarked.fs.readFile(configPath, 'utf8'), '{"userData":"preserve me"}');
});

await test('a config file appearing during atomic creation is preserved without task registration', async () => {
  const f = fixture();
  f.fs.beforeLink = async (_source, destination) => {
    assert.equal(destination, configPath);
    f.fs.putFile(destination, '{"userData":"created concurrently; preserve me"}');
  };
  await rejects(() => f.client.install(options('install')), /config|appeared|existing|preserv|install/i);
  assert.equal(await f.fs.readFile(configPath, 'utf8'), '{"userData":"created concurrently; preserve me"}');
  assert.equal(f.fs.mutations.filter(operation => operation.operation === 'rename').length, 0);
  assert.equal(taskOperations(f, 'register', 'start').length, 0);
});

await test('an otherwise owned task with elevated privilege is refused before mutation', async () => {
  const f = fixture();
  const planned = await f.client.plan(options());
  f.behavior.task = { ...ownedTask(planned.config, planned), runLevel: 'Highest' };
  await rejects(() => f.client.install(options('install')), /task|owned|policy|privilege/i);
  assert.equal(f.fs.mutations.length, 0);
  assert.equal(taskOperations(f, 'register', 'start', 'secureAcl').length, 0);
});

await test('physically aliased private directories and another Git root cannot bypass checkout boundaries', async () => {
  const alias = fixture();
  alias.fs.realpaths.set(alias.fs.key(localAppData), project);
  await rejects(() => alias.client.install(options('install')), /outside|checkout|private|path|runtime|directory/i);
  assert.equal(alias.fs.mutations.length, 0);
  assert.equal(taskOperations(alias, 'register', 'secureAcl').length, 0);
  const differentRoot = fixture();
  differentRoot.behavior.gitRoot = 'C:\\Another Repository';
  differentRoot.fs.putDirectory(differentRoot.behavior.gitRoot);
  await rejects(() => differentRoot.client.install(options('install')), /Git|checkout|repository|root|project/i);
  assert.equal(differentRoot.fs.mutations.length, 0);
  assert.equal(taskOperations(differentRoot, 'register', 'secureAcl').length, 0);
});

await test('symlinked executable, configuration and managed parent paths are refused', async () => {
  for (const filename of [codex, configPath, win.dirname(configPath)]) {
    const f = fixture();
    f.fs.putSymlink(filename, 'C:\\Another User\\redirected');
    await rejects(() => f.client.install(options('install')), /symbolic|symlink|reparse|link|path|file|directory/i);
    assert.equal(taskOperations(f, 'register', 'secureAcl').length, 0);
    assert.equal(f.fs.mutations.length, 0);
  }
});

await test('installed state is preserved when the same owned configuration is installed again', async () => {
  const f = fixture();
  const first = await f.client.plan(options());
  await f.client.install(options('install'));
  const saved = await config(f);
  const contents = await f.fs.readFile(configPath, 'utf8');
  f.fs.putFile(statePath, 'PERSISTED_STARTED_DRAFT_DO_NOT_RESET');
  f.behavior.task = ownedTask(saved, first);
  await f.client.install(options('install'));
  assert.equal(await f.fs.readFile(configPath, 'utf8'), contents);
  assert.equal(await f.fs.readFile(statePath, 'utf8'), 'PERSISTED_STARTED_DRAFT_DO_NOT_RESET');
});

await test('status reads the owned task without starting a worker or changing files', async () => {
  const f = fixture();
  await f.client.install(options('install'));
  f.calls.length = 0;
  f.fs.mutations.length = 0;
  const status = await f.client.status(parseZoohausArgs(['--status'], { cwd: project, pathApi: win }));
  assert.equal(status.task, taskName);
  assert.equal(status.enabled, true);
  assert.equal(status.scheduleVerified, true);
  assert.equal(status.lastTaskResult, 0);
  assert.equal(status.lastRunTimeUtc, '2026-10-13T10:00:00.0000000Z');
  assert.equal(status.nextRunTimeUtc, '2026-10-13T10:01:00.0000000Z');
  assert.equal(status.missedRuns, 0);
  assert.equal(status.inferenceVerified, false);
  assert.equal(f.calls.filter(call => win.basename(call.program).toLowerCase() === 'node.exe').length, 0);
  assert.equal(taskOperations(f, 'register', 'start', 'pause', 'secureAcl').length, 0);
  assert.equal(f.fs.mutations.length, 0);
});

await test('changed or disabled startup triggers and execution limits cannot be reported ready or overwritten', async () => {
  const alterations = [
    task => { task.triggers = []; },
    task => { task.triggers.pop(); },
    task => { task.triggers.push(structuredClone(task.triggers[1])); },
    task => { task.triggers[0].enabled = false; },
    task => { task.triggers[0].userId = differentSid; },
    task => { task.triggers[0].intervalSeconds = 1; },
    task => { task.triggers[0].delaySeconds = 300; },
    task => { task.triggers[1].kind = 'other'; },
    task => { task.triggers[1].enabled = false; },
    task => { task.triggers[1].intervalSeconds = 300; },
    task => { task.triggers[1].durationSeconds = 600; },
    task => { task.triggers[1].stopAtDurationEnd = true; },
    task => { task.triggers[1].endBoundary = '2026-10-13T10:00:00'; },
    task => { task.triggers[1].randomDelaySeconds = 15; },
    task => { task.triggers[1].startBoundary = ''; },
    task => { task.executionTimeLimitSeconds = 1; },
    task => { task.executionTimeLimitSeconds = 0; },
    task => { task.startWhenAvailable = false; },
  ];
  for (const change of alterations) {
    const f = fixture();
    const plan = await f.client.plan(options());
    await f.client.install(options('install'));
    const saved = await config(f);
    f.behavior.task = ownedTask(saved, plan);
    change(f.behavior.task);
    f.fs.putFile(statePath, 'PRESERVE_OWNED_STATE');
    const original = await f.fs.readFile(configPath, 'utf8');
    f.calls.length = 0;
    f.fs.mutations.length = 0;
    await rejects(() => f.client.status(options('status')), /task|policy|owned/i);
    await rejects(() => f.client.install(options('install')), /task|policy|owned/i);
    assert.equal(f.fs.mutations.length, 0);
    assert.equal(taskOperations(f, 'register', 'start', 'pause', 'secureAcl').length, 0);
    assert.equal(await f.fs.readFile(configPath, 'utf8'), original);
    assert.equal(await f.fs.readFile(statePath, 'utf8'), 'PRESERVE_OWNED_STATE');
  }
});

await test('status safely reports absent history while never claiming model inference', async () => {
  const f = fixture();
  await f.client.install(options('install'));
  Object.assign(f.behavior.task, { lastTaskResult: -1, lastRunTime: null, nextRunTime: 'not a timestamp', missedRuns: -1 });
  const status = await f.client.status(options('status'));
  assert.equal(status.lastTaskResult, null);
  assert.equal(status.lastRunTimeUtc, null);
  assert.equal(status.nextRunTimeUtc, null);
  assert.equal(status.missedRuns, null);
  assert.equal(status.inferenceVerified, false);
});

await test('run loads strict owned config and prepends native Codex and Git directories to child PATH', async () => {
  const f = fixture();
  await f.client.install(options('install'));
  f.calls.length = 0;
  await f.client.run(parseZoohausArgs(['--run'], { cwd: project, pathApi: win }));
  const child = f.calls.find(call => win.basename(call.program).toLowerCase() === 'node.exe');
  assert.ok(child);
  assert.equal(child.program, node);
  assert.equal(child.options.cwd, project);
  assert.ok(child.args.includes(helper));
  assert.ok(child.args.includes('--once'));
  assert.ok(!child.args.includes('--retry-failed'));
  assert.equal(child.args[child.args.indexOf('--agent') + 1], 'cloud');
  assert.equal(child.args[child.args.indexOf('--allow-from') + 1], 'local');
  assert.equal(child.args[child.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(child.args[child.args.indexOf('--max-messages') + 1], '1');
  const childPath = child.options.env.PATH || child.options.env.Path;
  assert.ok(childPath.startsWith(`${win.dirname(codex)};${win.dirname(git)};`));
});

await test('another SID or altered immutable execution policy cannot run the stored configuration', async () => {
  for (const alteration of [
    saved => ({ ...saved, ownerSid: differentSid }),
    saved => ({ ...saved, sandbox: 'workspace-write' }),
    saved => ({ ...saved, remote: 'https://github.com/another/public.git' }),
    saved => ({ ...saved, maxMessages: 10 }),
    saved => ({ ...saved, agent: 'local' }),
    saved => ({ ...saved, extra: 'unknown-field' }),
  ]) {
    const f = fixture();
    await f.client.install(options('install'));
    f.fs.putFile(configPath, JSON.stringify(alteration(await config(f))));
    f.calls.length = 0;
    await rejects(() => f.client.run(parseZoohausArgs(['--run'], { cwd: project, pathApi: win })), /SID|owner|policy|config|invalid|fixed/i);
    assert.equal(f.calls.filter(call => win.basename(call.program).toLowerCase() === 'node.exe').length, 0);
  }
});

await test('unsafe ACL verification fails closed before starting a worker', async () => {
  const f = fixture();
  await f.client.install(options('install'));
  f.behavior.safeAcl = false;
  f.calls.length = 0;
  await rejects(() => f.client.run(parseZoohausArgs(['--run'], { cwd: project, pathApi: win })), /ACL|permission|private|access/i);
  assert.equal(f.calls.filter(call => win.basename(call.program).toLowerCase() === 'node.exe').length, 0);
});

await test('abort and timeout terminate only the owned worker tree before its leader exits', async () => {
  for (const trigger of ['timeout', 'abort']) {
    const controller = new AbortController();
    const timers = [];
    const cleared = [];
    const stopped = [];
    const child = { pid: 42_424_242 };
    let rejectWorker;
    let closed = false;
    const pending = new Promise((_resolve, reject) => { rejectWorker = reject; });
    pending.child = child;
    const f = fixture({ dependencies: {
      signal: controller.signal,
      setTimer: (callback, milliseconds) => {
        const handle = { callback, milliseconds };
        timers.push(handle);
        return handle;
      },
      clearTimer: handle => { cleared.push(handle); },
      terminateProcess: (target, signal, options) => {
        assert.equal(target, child);
        assert.equal(options.platform, 'win32');
        assert.equal(closed, false, 'Worker leader exited before its tree could be terminated');
        stopped.push(signal);
        if (signal === 'SIGKILL') {
          closed = true;
          rejectWorker(new Error('Fixture owned worker closed after tree termination'));
        }
      },
    } });
    await f.client.install(options('install'));
    f.fs.putFile(statePath, 'PERSISTED_STARTED_STATE_KEEP');
    f.behavior.workerPromise = pending;
    const running = f.client.run(parseZoohausArgs(['--run'], { cwd: project, pathApi: win }));
    const rejected = rejects(() => running, /job|interrupted|state|uncertain|failed/i);
    for (let tick = 0; tick < 3000 && !timers.some(timer => timer.milliseconds === 1_100_000); tick++) await Promise.resolve();
    const deadline = timers.find(timer => timer.milliseconds === 1_100_000);
    assert.ok(deadline, 'Owned worker deadline was not scheduled');
    const started = f.calls.find(call => win.basename(call.program).toLowerCase() === 'node.exe' && call.args.includes('--once'));
    assert.equal(started.options.timeout, 0, 'Native execFile must not kill the leader before tree termination');
    if (trigger === 'abort') controller.abort(); else deadline.callback();
    assert.deepEqual(stopped, ['SIGTERM']);
    assert.equal(closed, false);
    const force = timers.find(timer => timer.milliseconds === 7_000);
    assert.ok(force, 'A bounded forced tree termination was not scheduled');
    force.callback();
    await rejected;
    assert.deepEqual(stopped, ['SIGTERM', 'SIGKILL']);
    assert.ok(cleared.includes(deadline) && cleared.includes(force));
    assert.equal(await f.fs.readFile(statePath, 'utf8'), 'PERSISTED_STARTED_STATE_KEEP');
  }
});

await test('pause only disables the exact owned task and never resets durable state', async () => {
  const f = fixture();
  const installed = await f.client.plan(options());
  await f.client.install(options('install'));
  const saved = await config(f);
  f.behavior.task = ownedTask(saved, installed);
  f.fs.putFile(statePath, 'PRIVATE_STATE_PRESERVE');
  f.calls.length = 0;
  await f.client.pause(parseZoohausArgs(['--pause'], { cwd: project, pathApi: win }));
  assert.equal(taskOperations(f, 'pause').length, 1);
  assert.equal(taskOperations(f, 'register', 'start').length, 0);
  assert.equal(await f.fs.readFile(statePath, 'utf8'), 'PRIVATE_STATE_PRESERVE');
  f.behavior.task = { ...f.behavior.task, sid: differentSid };
  f.calls.length = 0;
  await rejects(() => f.client.pause(parseZoohausArgs(['--pause'], { cwd: project, pathApi: win })), /task|SID|owned|owner|managed/i);
  assert.equal(taskOperations(f, 'pause').length, 0);
});

console.log(`Zoohaus connector tests passed (${passed} checks; mocked Windows only, no installation or paid calls).`);
