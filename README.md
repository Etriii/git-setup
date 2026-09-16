# Essential Git Setup

A numbered terminal wizard for essential Git global configuration. Requires Node.js 22+ (including npm) and Git on PATH. Push auto-tracking requires Git 2.37+.

Install directly from [GitHub](https://github.com/Etriii/git-setup) once this project is pushed to the repository:

```sh
npm install --global "git+https://github.com/Etriii/git-setup.git"
git-setup start
```

The npm global executable directory must be on PATH. On Windows, use `git-setup.cmd start` if PowerShell blocks the npm-generated `.ps1` launcher.

Available commands:

```sh
git-setup start   # Open the interactive wizard; git-setup alone also works
git-setup check   # Read-only status and value sources
git-setup --help  # Show command usage
```

To install from a local checkout instead:

```sh
npm install --global .
git-setup start
```

To run from source without installing:

```sh
npm start
```

No third-party dependencies or build step are required. Installation registers the `git-setup` command through npm's executable mapping. Native Node.js terminal input supports both arrow keys and number selection.

- Use Up/Down and Enter, or type a menu number and press Enter.
- Open identity to edit name, email, or both. Other categories show their description, current values, and choices.
- In aliases, use Space to toggle, or type a number and Enter to toggle. Press Enter without a number to finish.
- Use `0` and Enter for Back where shown. Esc or Q returns to the previous menu. Ctrl+C cancels.
- Select **Review and apply** to inspect all pending values, then explicitly choose **Apply changes**.
- Quit and refresh ask before discarding pending changes. No writes happen before applying.

```sh
npm run check  # Read-only status and value sources; also works without a terminal
npm test       # Tests use temporary, isolated Git configs
```

The menu shows configured, not set, partially configured, needs attention, and pending states. Values from system or repository settings are marked inherited. Not set means no explicit value was found; Git may still have a built-in default. Repository, worktree, and command overrides remain active over global values and appear during review.

The wizard covers author identity, VS Code/Cursor/Neovim/Vim/Nano, initial branch, pull strategy, push tracking, OS line endings, and `st`, `lg`, `undo` aliases. Custom values remain untouched unless you select replacements. Unchecked aliases are preserved. Choosing No for push tracking explicitly writes `false`.

Pull choices set both `pull.rebase` and `pull.ff` to avoid retaining a conflicting fast-forward-only policy. Rebase and merge use `pull.ff=true`; fast-forward only uses `pull.rebase=false` and `pull.ff=only`. Git's `ff=true` allows fast-forwards and merge commits when required.

Writes use argument arrays with no shell and run sequentially through `git config --global --replace-all`. Git selects its global file, normally `~/.gitconfig`, potentially an existing XDG config or `GIT_CONFIG_GLOBAL` override. Includes are inspected; unrelated settings and included files are preserved. No environment changes, installed packages, or database setup are needed.

The wizard checks for changes to reviewed settings immediately before applying. Git locks each individual write. The full batch is not transactional: a later failure may leave earlier settings applied. Errors list completed writes; refresh and inspect before retrying. Another program can still edit settings between individual writes. Do not edit the same settings concurrently.

Editor choices require their commands on PATH. The wizard does not install editors, create remotes, configure authentication, or rewrite existing commits. Git's normal repository overrides and `.gitattributes` rules still apply.
