import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyChanges, parseConfig, readState, runGit, stage } from '../src/git.js';
import { aliases, sections, statusFor, updatesFor, validateIdentity } from '../src/settings.js';
import { safe } from '../src/terminal.js';

const exec = promisify(execFile);

async function sandbox(t) {
  const directory = await mkdtemp(join(tmpdir(), 'git-setup-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Keep tests independent of the developer's config and repository environment.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: join(directory, 'xdg'),
    GIT_CONFIG_GLOBAL: join(directory, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
  });
  return { cwd: directory, env };
}

test('empty setup is readable without creating a global file', async t => {
  const options = await sandbox(t);
  const state = await readState(options);
  assert.equal(state.global.size, 0);
  assert.equal(state.effective.size, 0);
  assert.equal(statusFor(sections[0], state), 'Not set');
  await assert.rejects(readFile(options.env.GIT_CONFIG_GLOBAL), { code: 'ENOENT' });
});

test('writes selected settings sequentially and preserves unrelated settings', async t => {
  const options = await sandbox(t);
  await runGit(['config', '--global', 'credential.helper', 'custom-helper'], options);
  const before = await readState(options);
  const pending = new Map([
    ['user.name', '--help "quoted" Name; $(echo no)'], ['user.email', 'dev@example.com'],
    ['core.editor', 'code --wait'], ['init.defaultbranch', 'main'],
    ...updatesFor('pull', 'rebase'), ['push.autosetupremote', 'true'], ['core.autocrlf', 'input'],
    ...aliases.map(alias => [alias.key, alias.value]),
  ]);
  const result = await applyChanges(pending, before, options);
  assert.deepEqual(result.applied, [...pending.keys()]);
  for (const [key, value] of pending) assert.equal(result.state.global.get(key).at(-1).value, value);
  assert.equal((await runGit(['config', '--global', 'credential.helper'], options)).trim(), 'custom-helper');
});

test('pull choices override prior ff-only and rebase policies', async t => {
  const options = await sandbox(t);
  for (const mode of ['ff-only', 'rebase', 'merge']) {
    const before = await readState(options);
    const result = await applyChanges(new Map(updatesFor('pull', mode)), before, options);
    assert.equal(result.state.effective.get('pull.ff').at(-1).value, mode === 'ff-only' ? 'only' : 'true');
    assert.equal(result.state.effective.get('pull.rebase').at(-1).value, String(mode === 'rebase'));
  }
});

test('detects global edits before applying any pending write', async t => {
  const options = await sandbox(t);
  const before = await readState(options);
  await runGit(['config', '--global', 'user.name', 'Another tool'], options);
  await assert.rejects(applyChanges(new Map([['user.email', 'a@b.test'], ['user.name', 'Wizard']]), before, options), /changed since inspection/);
  assert.equal((await readState(options)).global.has('user.email'), false);
});

test('reports inherited local settings and catches changed repository overrides', async t => {
  const options = await sandbox(t);
  await runGit(['init', '--quiet', options.cwd], options);
  await runGit(['config', 'core.editor', 'vim'], options);
  const before = await readState(options);
  assert.match(statusFor(sections[1], before), /Configured: vim \(inherited\)/);
  assert.equal(before.global.has('core.editor'), false);
  await runGit(['config', 'core.editor', 'nano'], options);
  await assert.rejects(applyChanges(new Map([['core.editor', 'code --wait']]), before, options), /changed since inspection/);
});

test('included globals retain provenance without changing the included file', async t => {
  const options = await sandbox(t);
  const included = join(options.cwd, 'included.gitconfig');
  await writeFile(included, '[user]\nname = Included Name\n');
  await runGit(['config', '--global', 'include.path', included], options);
  const state = await readState(options);
  assert.equal(state.global.get('user.name').at(-1).value, 'Included Name');
  assert.match(state.global.get('user.name').at(-1).origin, /included.gitconfig/);
  const result = await applyChanges(new Map([['user.name', 'Updated Name']]), state, options);
  assert.equal(result.state.global.get('user.name').at(-1).value, 'Updated Name');
  assert.match(await readFile(included, 'utf8'), /Included Name/);
});

test('replaces duplicate global entries with one reviewed value', async t => {
  const options = await sandbox(t);
  await runGit(['config', '--global', '--add', 'user.name', 'First'], options);
  await runGit(['config', '--global', '--add', 'user.name', 'Second'], options);
  const before = await readState(options);
  assert.equal(before.global.get('user.name').length, 2);
  const pending = new Map();
  stage(pending, before, 'user.name', 'Second');
  assert.equal(pending.size, 1);
  const result = await applyChanges(pending, before, options);
  assert.equal(result.state.global.get('user.name').length, 1);
  assert.equal(result.state.global.get('user.name')[0].value, 'Second');
});

test('failed sequential write reports earlier writes accurately', async t => {
  const options = await sandbox(t);
  const before = await readState(options);
  await assert.rejects(applyChanges(new Map([['user.name', 'Written'], ['invalid-key', 'bad']]), before, options), /Written before stopping: user.name/);
  assert.equal((await readState(options)).global.get('user.name').at(-1).value, 'Written');
});

test('staging same value removes pending edits; no write occurs while staging', async t => {
  const options = await sandbox(t);
  await runGit(['config', '--global', 'user.name', 'Original'], options);
  const state = await readState(options);
  const pending = new Map();
  stage(pending, state, 'user.name', 'Edited');
  assert.equal((await readState(options)).global.get('user.name').at(-1).value, 'Original');
  stage(pending, state, 'user.name', 'Original');
  assert.equal(pending.size, 0);
});

test('status distinguishes missing, partial, invalid, and pending settings', () => {
  const records = new Map([
    ['alias.st', [{ scope: 'global', value: 'status -s' }]],
    ['pull.rebase', [{ scope: 'global', value: 'true' }]],
    ['pull.ff', [{ scope: 'global', value: 'only' }]],
  ]);
  const state = { global: records, effective: records };
  assert.match(statusFor(sections[6], state), /Partially configured/);
  assert.match(statusFor(sections[3], state), /Needs attention/);
  assert.match(statusFor(sections[0], state, new Map([['user.name', 'Name']])), /Pending; Needs attention/);
  assert.match(statusFor(sections[4], state, new Map([['push.autosetupremote', 'false']])), /Configured: false/);
});

test('parses multiline values and escapes terminal control characters', () => {
  const parsed = parseConfig('global\0file:test\0user.name\nA\nB\0');
  assert.equal(parsed.get('user.name')[0].value, 'A\nB');
  assert.equal(safe('\x1b[2J\n'), '\\x1b[2J\\x0a');
  assert.ok(validateIdentity('user.name', 'A\nB'));
  assert.ok(validateIdentity('user.email', 'bad address'));
  assert.equal(validateIdentity('user.email', 'name@example.com'), undefined);
});

test('read-only CLI report works without a TTY and never writes', async t => {
  const options = await sandbox(t);
  const cli = resolve('src/cli.js');
  for (const command of ['check', '--check']) {
    const { stdout } = await exec(process.execPath, [cli, command], options);
    assert.match(stdout, /User identity \[Not set\]/);
    assert.match(stdout, /Push tracking \[Not set\]/);
  }
  await assert.rejects(readFile(options.env.GIT_CONFIG_GLOBAL), { code: 'ENOENT' });
  await assert.rejects(exec(process.execPath, [cli], options), error => /requires a terminal/.test(error.stdout));
  await assert.rejects(exec(process.execPath, [cli, 'start'], options), error => /requires a terminal/.test(error.stdout));
});

test('CLI help describes installed commands and rejects unknown commands', async t => {
  const options = await sandbox(t);
  const cli = resolve('src/cli.js');
  for (const command of ['help', '--help', '-h']) {
    const { stdout } = await exec(process.execPath, [cli, command], options);
    assert.match(stdout, /Usage: git-setup \[start \| check \| --help\]/);
  }
  for (const args of [['unknown'], ['start', 'unexpected']]) {
    await assert.rejects(exec(process.execPath, [cli, ...args], options), error => /Unknown arguments/.test(error.stdout));
  }
  await assert.rejects(readFile(options.env.GIT_CONFIG_GLOBAL), { code: 'ENOENT' });
});
