import { aliases, choices, sections, statusFor, pullMode, updatesFor, validateIdentity } from './settings.js';
import { applyChanges, readState, stage } from './git.js';
import { menu, print, text } from './terminal.js';

export function report(state) {
  print('Git Setup — current effective settings');
  sections.forEach((section, index) => print(`${index + 1}. ${section.label} [${statusFor(section, state)}]`));
  print('Inherited = system, repository, worktree, or command setting. Writes target global settings only.');
  for (const section of sections) {
    for (const key of section.keys) {
      const record = state.effective.get(key)?.at(-1);
      if (record) print(`  ${key} = ${record.value} (${record.scope}; ${record.origin})`);
    }
  }
}

export async function wizard() {
  let state = await readState();
  const pending = new Map();
  const value = key => pending.has(key) ? pending.get(key) : state.effective.get(key)?.at(-1)?.value;
  const put = (key, value) => stage(pending, state, key, value);

  async function leave() {
    if (!pending.size) return true;
    return await menu('Discard pending changes and quit?', [
      { value: false, label: 'Keep editing' }, { value: true, label: 'Discard and quit' },
    ]) === true;
  }

  async function identity(section) {
    while (true) {
      print();
      print(section.description);
      const selection = await menu('User identity', [
        { value: 'user.name', label: `Author name [${value('user.name') ?? 'Not set'}]` },
        { value: 'user.email', label: `Author email [${value('user.email') ?? 'Not set'}]` },
        { value: 'both', label: 'Configure both' }, { number: 0, value: null, label: 'Back' },
      ]);
      if (selection === null) return;
      const keys = selection === 'both' ? section.keys : [selection];
      for (const key of keys) {
        const question = key === 'user.name' ? 'What is your Git commit author name?' : 'What is your Git commit email?';
        put(key, await text(question, value(key), answer => validateIdentity(key, answer)));
      }
    }
  }

  async function edit(section) {
    if (section.id === 'identity') return identity(section);
    print();
    print(section.description);
    for (const key of section.keys) {
      const record = state.effective.get(key)?.at(-1);
      print(`${key}: ${value(key) ?? 'Not set'}${record ? ` (${record.scope}; ${record.origin})` : ''}`);
    }
    if (section.id === 'aliases') {
      const selected = await menu('Select essential shortcuts to add', aliases.map(alias => ({
        value: alias.key, label: `${alias.label}: ${alias.description} — ${alias.value}`,
      })), {
        multiple: true,
        selected: aliases.filter(alias => value(alias.key) === undefined || value(alias.key) === alias.value).map(alias => alias.key),
      });
      if (selected !== null) {
        for (const alias of aliases) {
          if (selected.includes(alias.key)) put(alias.key, alias.value);
          else pending.delete(alias.key);
        }
      }
      return;
    }
    let initial = value(section.keys[0]);
    if (section.id === 'pull') initial = pullMode(value);
    if (section.id === 'endings' && initial === undefined) initial = process.platform === 'win32' ? 'true' : 'input';
    const selected = await menu(section.label, [
      ...choices[section.id].map(([label, item]) => ({ value: item, label: `${label}${initial === item ? ' [Current / selected]' : ''}` })),
      { number: 0, value: null, label: 'Back' },
    ], { initial });
    if (selected !== null) for (const [key, next] of updatesFor(section.id, selected)) put(key, next);
  }

  async function review() {
    if (!pending.size) { print('No pending changes.'); return; }
    print();
    print('Review global configuration changes');
    for (const [key, next] of pending) {
      const before = state.global.get(key)?.at(-1)?.value ?? '(not set globally)';
      print(`${key}: ${JSON.stringify(before)} -> ${JSON.stringify(next)}`);
      print(`  git config --global --replace-all -- ${key} ${JSON.stringify(next)}`);
      const effective = state.effective.get(key)?.at(-1);
      if (effective && ['local', 'worktree', 'command'].includes(effective.scope)) {
        print(`  ${effective.scope} override remains active here: ${effective.value}`);
      }
    }
    const confirmed = await menu('Apply these global changes?', [
      { value: false, label: 'Back to menu' }, { value: true, label: 'Apply changes' },
    ]);
    if (confirmed !== true) return;
    try {
      const result = await applyChanges(pending, state);
      state = result.state;
      pending.clear();
      print('~/.gitconfig updated successfully!');
      print('Git chooses the global file location; XDG configuration or GIT_CONFIG_GLOBAL may use another path.');
    } catch (error) {
      print(`Apply stopped: ${error.message}`);
      print('Refresh settings before retrying. Some changes may already have been written.');
    }
  }

  print('Git Setup — review changes before writing global settings');
  while (true) {
    const selection = await menu('Essential Git configuration', [
      ...sections.map(section => ({ value: section.id, label: `${section.label} [${statusFor(section, state, pending)}]` })),
      { value: 'review', label: `Review and apply (${pending.size} pending settings)` },
      { value: 'refresh', label: 'Refresh settings (discards pending changes)' },
      { number: 0, value: 'quit', label: 'Quit' },
    ]);
    if (selection === null || selection === 'quit') { if (await leave()) return; }
    else if (selection === 'review') await review();
    else if (selection === 'refresh') {
      if (pending.size && await menu('Discard pending changes and reload?', [
        { value: false, label: 'Keep editing' }, { value: true, label: 'Discard and refresh' },
      ]) !== true) continue;
      const refreshed = await readState();
      state = refreshed;
      pending.clear();
    } else await edit(sections.find(section => section.id === selection));
  }
}
