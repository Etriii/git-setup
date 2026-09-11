import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { keys } from './settings.js';

const exec = promisify(execFile);
const pattern = `^(${keys.map(key => key.replaceAll('.', '\\.')).join('|')})$`;

export async function runGit(args, options = {}) {
  try {
    const { stdout } = await exec('git', args, { encoding: 'utf8', windowsHide: true, ...options });
    return stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git is not installed or is unavailable on PATH.');
    if (error.code === 1 && args.includes('--get-regexp')) return '';
    throw new Error(error.stderr?.trim() || error.message);
  }
}

export function parseConfig(output) {
  const records = new Map();
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 3 !== 0) throw new Error('Unexpected Git configuration output.');
  for (let index = 0; index < fields.length; index += 3) {
    const [scope, origin, entry] = fields.slice(index, index + 3);
    const separator = entry.indexOf('\n');
    const key = (separator < 0 ? entry : entry.slice(0, separator)).toLowerCase();
    if (!keys.includes(key)) continue;
    const value = separator < 0 ? '' : entry.slice(separator + 1);
    const entries = records.get(key) ?? [];
    entries.push({ scope, origin, value });
    records.set(key, entries);
  }
  return records;
}

export async function readState(options = {}) {
  const flags = ['--includes', '--null', '--show-scope', '--show-origin', '--get-regexp', pattern];
  const [global, effective] = await Promise.all([
    runGit(['config', '--global', ...flags], options),
    runGit(['config', ...flags], options),
  ]);
  return { global: parseConfig(global), effective: parseConfig(effective) };
}

export function stage(pending, state, key, value) {
  const current = state.global.get(key)?.at(-1)?.value;
  if (current === value && state.global.get(key)?.length === 1) pending.delete(key);
  else pending.set(key, value);
}

export async function applyChanges(pending, snapshot, options = {}) {
  const current = await readState(options);
  for (const key of pending.keys()) {
    for (const scope of ['global', 'effective']) {
      if (JSON.stringify(current[scope].get(key)) !== JSON.stringify(snapshot[scope].get(key))) {
        throw new Error(`${key} changed since inspection. Refresh settings and review again.`);
      }
    }
  }
  const applied = [];
  try {
    for (const [key, value] of pending) {
      await runGit(['config', '--global', '--replace-all', '--', key, value], options);
      applied.push(key);
    }
    const state = await readState(options);
    for (const [key, value] of pending) {
      if (state.global.get(key)?.at(-1)?.value !== value) {
        throw new Error(`${key} is overridden by an included global config file.`);
      }
    }
    return { state, applied };
  } catch (error) {
    throw new Error(`${error.message}\nWritten before stopping: ${applied.join(', ') || 'none'}. Inspect settings before retrying.`);
  }
}
