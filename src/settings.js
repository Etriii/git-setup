export const aliases = [
  { key: 'alias.st', label: 'git st', value: 'status -s', description: 'Short status output' },
  { key: 'alias.lg', label: 'git lg', value: 'log --oneline --graph --decorate', description: 'One-line visual graph log' },
  { key: 'alias.undo', label: 'git undo', value: 'reset --soft HEAD~1', description: 'Soft undo last commit; keeps changes staged' },
];

export const sections = [
  { id: 'identity', label: 'User identity', keys: ['user.name', 'user.email'], description: 'Git records your author name and email in each new commit.' },
  { id: 'editor', label: 'Core editor', keys: ['core.editor'], description: 'Git opens this editor for commit messages and interactive rebase edits. The editor command must be installed and available on PATH.' },
  { id: 'branch', label: 'Initial branch', keys: ['init.defaultbranch'], description: 'Sets the initial branch name for new repositories created with git init.' },
  { id: 'pull', label: 'Pull behavior', keys: ['pull.rebase', 'pull.ff'], description: 'Controls how git pull integrates remote commits. Rebase replays local commits; merge allows merge commits; fast-forward only rejects diverged history.' },
  { id: 'push', label: 'Push tracking', keys: ['push.autosetupremote'], description: 'Automatically sets upstream tracking on the first default push, avoiding git push --set-upstream origin <branch>. Requires Git 2.37 or newer and a configured remote.' },
  { id: 'endings', label: 'Line endings', keys: ['core.autocrlf'], description: 'Normalizes text line endings. macOS/Linux converts CRLF to LF on commit; Windows also checks text out as CRLF. Repository .gitattributes rules take precedence.' },
  { id: 'aliases', label: 'Git aliases', keys: aliases.map(alias => alias.key), description: 'Adds shortcuts to Git. Unchecked aliases stay unchanged, including custom commands.' },
];

export const keys = sections.flatMap(section => section.keys);

export const choices = {
  editor: [
    ['VS Code (wait)', 'code --wait'], ['Cursor (wait)', 'cursor --wait'],
    ['Neovim', 'nvim'], ['Vim', 'vim'], ['Nano', 'nano'],
  ],
  branch: [['main (recommended)', 'main'], ['master', 'master']],
  pull: [['Rebase — linear history', 'rebase'], ['Merge — allow merge commits', 'merge'], ['Fast-forward only — reject divergence', 'ff-only']],
  push: [['Yes — automatically set upstream', 'true'], ['No — set upstream manually', 'false']],
  endings: [['macOS / Linux — LF', 'input'], ['Windows — CRLF', 'true']],
};

export function asBoolean(value) {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (['true', 'yes', 'on', '1', ''].includes(normalized)) return true;
  if (['false', 'no', 'off', '0'].includes(normalized)) return false;
  return undefined;
}

export function pullMode(value) {
  const rebase = value('pull.rebase');
  const ff = value('pull.ff');
  if (ff === 'only') return 'ff-only';
  if (asBoolean(rebase) === true || ['merges', 'interactive', 'preserve'].includes(rebase)) return 'rebase';
  if (asBoolean(rebase) === false || asBoolean(ff) !== undefined) return 'merge';
  return undefined;
}

export function updatesFor(id, selection) {
  if (id === 'pull') {
    // Set both keys so an inherited ff-only policy cannot override a new choice.
    return selection === 'ff-only'
      ? [['pull.rebase', 'false'], ['pull.ff', 'only']]
      : [['pull.rebase', String(selection === 'rebase')], ['pull.ff', 'true']];
  }
  const section = sections.find(item => item.id === id);
  return [[section.keys[0], selection]];
}

export function validateIdentity(key, value) {
  if (!value.trim()) return 'Enter a non-empty value.';
  if (/[\x00-\x1f\x7f]/.test(value)) return 'Control characters are not allowed.';
  if (key === 'user.email' && !/^[^\s@]+@[^\s@]+$/.test(value)) return 'Enter an email address, such as name@example.com.';
  return undefined;
}

export function statusFor(section, state, pending = new Map()) {
  const value = key => pending.has(key) ? pending.get(key) : state.effective.get(key)?.at(-1)?.value;
  const present = section.keys.filter(key => value(key) !== undefined);
  const staged = section.keys.some(key => pending.has(key));
  let status;
  if (!present.length) status = 'Not set';
  else if (section.id === 'identity' && section.keys.some(key => validateIdentity(key, value(key) ?? ''))) status = 'Needs attention';
  else if (section.id === 'pull' && value('pull.ff') === 'only' && (asBoolean(value('pull.rebase')) === true || ['merges', 'interactive', 'preserve'].includes(value('pull.rebase')))) status = 'Needs attention: rebase + ff-only';
  else if (section.id === 'pull' && ((value('pull.rebase') !== undefined && asBoolean(value('pull.rebase')) === undefined && !['merges', 'interactive', 'preserve'].includes(value('pull.rebase'))) || (value('pull.ff') !== undefined && value('pull.ff') !== 'only' && asBoolean(value('pull.ff')) === undefined))) status = 'Needs attention';
  else if (section.id === 'push' && asBoolean(value(section.keys[0])) === undefined) status = 'Needs attention';
  else if (section.id === 'endings' && value(section.keys[0]) !== 'input' && asBoolean(value(section.keys[0])) === undefined) status = 'Needs attention';
  else if (section.id === 'aliases' && present.length < section.keys.length) status = 'Partially configured';
  else status = 'Configured';
  const values = section.id === 'pull' ? pullMode(value) : present.map(key => value(key)).join(' / ');
  const inherited = !staged && present.some(key => state.effective.get(key)?.at(-1)?.scope !== 'global');
  return `${staged ? 'Pending; ' : ''}${status}${values ? `: ${values}` : ''}${inherited ? ' (inherited)' : ''}`;
}
