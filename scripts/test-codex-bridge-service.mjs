import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServicePlan, installService, parseServiceArgs } from './codex-bridge-service.mjs';

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL('./codex-bridge-service.mjs', import.meta.url));
const temporary = await fs.mkdtemp(path.join(tmpdir(), 'vive-service-test-'));

try {
  const project = path.join(temporary, 'project with % $ & " <spaces>');
  const codex = path.join(temporary, 'bin', 'codex');
  const state = path.join(temporary, 'private-state', 'local.json');
  const args = ['--project', project, '--node', process.execPath, '--codex', codex,
    '--allow-from', 'cloud', '--allow-from', 'helper', '--state', state];
  const options = parseServiceArgs(args, { home: temporary, platform: 'linux' });
  const linux = createServicePlan(options);
  assert.equal(linux.validated, false);
  assert.equal(linux.files.length, 2);
  assert.equal(linux.sandbox, 'read-only');
  assert.deepEqual(linux.allowFrom, ['cloud', 'helper']);
  assert.match(linux.files[0].content, /Type=oneshot/);
  assert.match(linux.files[0].content, /--max-messages" "1"/);
  assert.match(linux.files[0].content, /%% \$\$/);
  assert.match(linux.files[1].content, /OnUnitInactiveSec=60s/);
  assert.ok(!linux.files.some(file => file.content.includes('--retry-failed')));
  assert.ok(linux.files.every(file => file.mode === '0600'));
  assert.equal(linux.commands.check.cwd, project);
  assert.ok(linux.notes.some(note => note.includes('not authenticated identities') && note.includes('every writer')));

  const mac = createServicePlan({ ...options, platform: 'darwin', agent: 'local--helper' }, { uid: 501 });
  assert.equal(mac.files.length, 1);
  assert.match(mac.files[0].content, /&amp; &quot; &lt;spaces&gt;/);
  assert.match(mac.files[0].content, /<key>StartInterval<\/key><integer>60<\/integer>/);
  assert.ok(!mac.files[0].content.split('\n')[2].slice(4, -3).includes('--'));
  assert.deepEqual(mac.commands.start.args.slice(0, 2), ['bootstrap', 'gui/501']);
  const macTarget = 'gui/501/mx.vivedeutsch.codex-bridge.local--helper';
  assert.deepEqual(mac.commands.disable.steps, [
    { executable: 'launchctl', args: ['disable', macTarget] },
    { executable: 'launchctl', args: ['bootout', macTarget] },
  ], 'Disabling a loaded LaunchAgent must prevent reloading and unload its interval definition.');
  assert.deepEqual(mac.remove.steps, mac.commands.disable.steps, 'Removal must include unloading before deleting the plist.');
  assert.match(mac.notes.join('\n'), /Bootout can terminate a running task; wait for it to finish first/);
  assert.deepEqual(linux.remove.steps, [linux.commands.disable]);

  const windowsArgs = ['--project', 'C:\\Work\\VIVE', '--node', 'C:\\Program Files\\nodejs\\node.exe',
    '--codex', 'C:\\Tools\\Codex\\codex.exe', '--allow-from', 'local', '--state', 'C:\\Users\\Tester\\private\\cloud.json'];
  const windowsOptions = parseServiceArgs([...windowsArgs, '--platform', 'win32'], { home: temporary, platform: 'linux' });
  const windows = createServicePlan(windowsOptions);
  assert.equal(windows.files.length, 0);
  assert.ok(windows.notes.some(note => note.includes('unsupported')));
  assert.equal(windows.commands.manual.executable, 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(windows.commands.manual.args[0], 'C:\\Work\\VIVE\\scripts\\codex-bridge-codex.mjs');
  assert.equal(windows.commands.check.cwd, 'C:\\Work\\VIVE');
  assert.equal(windows.commands.check.environment.PATH, 'C:\\Tools\\Codex;C:\\Program Files\\nodejs');
  assert.deepEqual(windows.directories, ['C:\\Users\\Tester\\private']);
  assert.deepEqual(createServicePlan(parseServiceArgs(['--platform', 'win32', ...windowsArgs], { platform: 'linux' })), windows,
    'The target platform must be selected independently of option order.');
  const windowsDefaultState = parseServiceArgs(['--platform', 'win32', ...windowsArgs.slice(0, -2), '--home', 'C:\\Users\\Tester'], { platform: 'linux' });
  assert.equal(windowsDefaultState.state, 'C:\\Users\\Tester\\.local\\state\\vive-codex-bridge\\codex-local.json');
  assert.throws(() => parseServiceArgs([...windowsArgs, '--platform', 'win32', '--project', '\\Work\\VIVE']), /absolute target-platform/);
  assert.throws(() => parseServiceArgs([...windowsArgs, '--platform', 'win32', '--state', 'c:\\work\\vive\\state.json']), /outside/);
  assert.throws(() => parseServiceArgs([...windowsArgs, '--platform', 'win32', '--install'], { platform: 'linux' }), /Cross-platform/);
  const posixPreview = createServicePlan(parseServiceArgs(['--platform', 'linux', '--project', '/srv/vive',
    '--node', '/opt/node/bin/node', '--codex', '/opt/codex/bin/codex', '--allow-from', 'cloud', '--home', '/home/preview'],
  { platform: 'win32', home: 'C:\\Users\\Host' }));
  assert.equal(posixPreview.files[0].path, '/home/preview/.config/systemd/user/vive-codex-bridge-local.service');
  assert.equal(posixPreview.commands.check.args[0], '/srv/vive/scripts/codex-bridge-codex.mjs');
  assert.equal(posixPreview.commands.check.environment.PATH, '/opt/codex/bin:/opt/node/bin:/usr/local/bin:/usr/bin:/bin');
  assert.throws(() => parseServiceArgs([...args, '--install', '--home', temporary]), /previews only/);

  assert.throws(() => parseServiceArgs(args.filter((_, index) => ![6, 7, 8, 9].includes(index))), /allow-from/);
  assert.throws(() => parseServiceArgs([...args, '--state', path.join(project, 'state.json')]), /outside/);
  assert.throws(() => parseServiceArgs([...args, '--allow-from', 'all']), /wildcards/);
  assert.throws(() => parseServiceArgs([...args, '--remote', 'https://token@example.com/repo.git']), /credentials/);
  assert.throws(() => parseServiceArgs([...args, '--remote', 'https://example.com/repo.git?token=test']), /query/);
  assert.throws(() => parseServiceArgs([...args, '--remote', 'ext::unsafe-helper']), /Invalid mailbox/);
  assert.throws(() => parseServiceArgs([...args, 'accidental-secret-value']), /^Error: Unknown option\. See --help\.$/);
  assert.throws(() => parseServiceArgs([...args, '--plan', '--install']), /either/);
  assert.throws(() => parseServiceArgs([...args, '--node', 'node']), /absolute/);

  const preview = await execFileAsync(process.execPath, [script, ...args, '--plan']);
  assert.equal(JSON.parse(preview.stdout).validated, false);
  assert.deepEqual(await fs.readdir(temporary), [], 'Preview must write no files.');

  if (process.platform === 'linux') {
    // No actual systemctl is called: exercise installation orchestration in /tmp.
    await fs.mkdir(project, { recursive: true });
    await fs.mkdir(path.dirname(codex), { recursive: true });
    await fs.writeFile(codex, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const calls = [];
    const dependencies = { runCommand: async spec => {
      calls.push(spec);
      return { stdout: spec.args[0] === '--version' ? 'v24.0.0\n' : '', stderr: '' };
    } };
    const result = await installService(options, linux, dependencies);
    assert.equal(result.installed, true);
    assert.ok(calls.some(spec => spec.args.includes('--check')));
    assert.ok(calls.some(spec => spec.args.includes('inbox')));
    assert.ok(calls.some(spec => spec.args.includes('--now')));
    for (const file of linux.files) {
      assert.equal(await fs.readFile(file.path, 'utf8'), file.content);
      assert.equal((await fs.stat(file.path)).mode & 0o777, 0o600);
    }
    const analyzer = '/usr/bin/systemd-analyze';
    if (await fs.access(analyzer, fs.constants.X_OK).then(() => true, () => false)) {
      await execFileAsync(analyzer, ['--user', 'verify', ...linux.files.map(file => file.path)], {
        env: { ...process.env, XDG_RUNTIME_DIR: temporary }, maxBuffer: 4096,
      });
    }
    await installService(options, linux, dependencies);
    const privateTarget = path.join(temporary, 'unrelated-private-file');
    await fs.writeFile(privateTarget, 'preserve this unrelated file\n', { mode: 0o640 });
    await fs.chmod(privateTarget, 0o640);
    let swapped = false;
    const swappingDependencies = { runCommand: async spec => {
      if (!swapped && spec.args.includes('--check')) {
        swapped = true;
        await fs.unlink(linux.files[0].path);
        await fs.symlink(privateTarget, linux.files[0].path);
      }
      return dependencies.runCommand(spec);
    } };
    calls.length = 0;
    await assert.rejects(installService(options, linux, swappingDependencies), { code: 'ELOOP' });
    assert.equal((await fs.stat(privateTarget)).mode & 0o777, 0o640, 'A swapped symlink must not change target permissions.');
    assert.equal(await fs.readFile(privateTarget, 'utf8'), 'preserve this unrelated file\n');
    assert.ok(!calls.some(spec => spec.args.includes('--now')), 'A failed file check must not activate the schedule.');
    await fs.unlink(linux.files[0].path);
    await fs.writeFile(linux.files[0].path, linux.files[0].content, { mode: 0o600 });
    await fs.writeFile(linux.files[1].path, 'user-owned configuration\n');
    calls.length = 0;
    await assert.rejects(installService(options, linux, dependencies), /unmanaged/);
    assert.equal(calls.length, 0, 'Unknown files must be rejected before readiness commands.');
    assert.equal(await fs.readFile(linux.files[1].path, 'utf8'), 'user-owned configuration\n');
    await fs.unlink(linux.files[1].path);
    await fs.symlink(linux.files[0].path, linux.files[1].path);
    await assert.rejects(installService(options, linux, dependencies), /unexpected file/);
    await fs.unlink(linux.files[1].path);
    const outside = path.join(temporary, 'outside-link');
    await fs.symlink(project, outside);
    const unsafe = { ...options, state: path.join(outside, 'not-created', 'state.json') };
    await assert.rejects(installService(unsafe, createServicePlan(unsafe), dependencies), /resolves inside/);
  }
  console.log('Codex bridge service plans, path escaping, no-write preview, idempotence, and unknown-file protection passed.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
