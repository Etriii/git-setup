#!/usr/bin/env node
import { readState } from './git.js';
import { wizard, report } from './wizard.js';
import { Cancelled, print } from './terminal.js';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['help', '--help', '-h'].includes(args[0])) {
    print('Usage: git-setup [start | check | --help]');
    print('start: interactive numbered wizard (also the default with no arguments).');
    print('check: read-only Git configuration status. --check is also supported.');
  } else if (args.length === 1 && ['check', '--check'].includes(args[0])) {
    report(await readState());
  } else if (args.length && !(args.length === 1 && args[0] === 'start')) {
    throw new Error('Unknown arguments. Run with --help for usage.');
  } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive mode requires a terminal. Use --check for a read-only report.');
  } else {
    await wizard();
  }
} catch (error) {
  if (error instanceof Cancelled) {
    print('Cancelled. Pending changes discarded. Completed writes remain applied.');
    process.exitCode = 130;
  } else {
    print(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
