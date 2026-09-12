import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';

export class Cancelled extends Error {}

// Escape control characters from config values before displaying them in a terminal.
export function safe(value) {
  return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function print(value = '') {
  process.stdout.write(`${safe(value)}\n`);
}

export function menu(title, items, { multiple = false, selected = [], initial } = {}) {
  const input = process.stdin;
  const output = process.stdout;
  let cursor = Math.max(0, items.findIndex(item => item.value === initial));
  let digits = '';
  let lines = 0;
  const checked = new Set(selected);
  print();
  print(title);
  print(multiple
    ? '↑/↓ Move · Space toggle · Number + Enter toggle · Enter done · Esc back'
    : '↑/↓ Move · Number + Enter select · Enter open · Esc back · Q back');
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    function render() {
      if (lines) output.write(`\x1b[${lines}A`);
      const capacity = Math.max(1, Math.min(items.length, (output.rows || 24) - 6));
      const first = Math.max(0, Math.min(cursor - capacity + 1, items.length - capacity));
      for (let index = first; index < first + capacity; index++) {
        const item = items[index];
        const mark = multiple ? `[${checked.has(item.value) ? 'x' : ' '}] ` : '';
        const row = `${index === cursor ? '>' : ' '} ${item.number ?? index + 1}. ${mark}${safe(item.label)}`;
        // Reserve room for wide Unicode characters to prevent wrapped redraws.
        const limit = Math.max(1, (output.columns || 80) - 1);
        let width = 0;
        let visible = '';
        for (const character of row) {
          const nextWidth = character.codePointAt(0) > 0xff ? 2 : 1;
          if (width + nextWidth > limit - 1) { visible += '…'; break; }
          visible += character;
          width += nextWidth;
        }
        output.write(`\x1b[2K\r${visible}\n`);
      }
      output.write(`\x1b[2K\r${digits ? `Number: ${digits}` : ' '}\n`);
      lines = capacity + 1;
    }
    function finish(value, error) {
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.setRawMode(false);
      input.pause();
      if (error) reject(error);
      else resolve(value);
    }
    function onEnd() { finish(undefined, new Cancelled()); }
    function onKey(character, key = {}) {
      if (key.ctrl && key.name === 'c') return finish(undefined, new Cancelled());
      if (key.name === 'escape' || character === 'q') return finish(null);
      if (key.name === 'up' || key.name === 'down') {
        digits = '';
        cursor = (cursor + (key.name === 'up' ? -1 : 1) + items.length) % items.length;
      } else if (/^[0-9]$/.test(character ?? '')) {
        digits = (digits + character).slice(-2);
      } else if (key.name === 'backspace') {
        digits = digits.slice(0, -1);
      } else if (key.name === 'return' || (multiple && character === ' ')) {
        if (digits) {
          const index = items.findIndex((item, index) => String(item.number ?? index + 1) === String(Number(digits)));
          if (index === -1) { digits = ''; render(); return; }
          cursor = index;
        }
        if (multiple) {
          if (key.name === 'return' && !digits) return finish([...checked]);
          const value = items[cursor].value;
          if (checked.has(value)) checked.delete(value);
          else checked.add(value);
          digits = '';
        } else return finish(items[cursor].value);
      }
      render();
    }
    input.on('keypress', onKey);
    input.once('end', onEnd);
    render();
  });
}

export async function text(question, current, validate) {
  const input = process.stdin;
  const reader = createInterface({ input, output: process.stdout });
  const controller = new AbortController();
  reader.on('SIGINT', () => controller.abort());
  reader.on('close', () => controller.abort());
  try {
    while (true) {
      const answer = await reader.question(`${question}${current ? ` [${safe(current)}]` : ''}\n> `, { signal: controller.signal });
      const value = answer.trim() || current || '';
      const error = validate(value);
      if (!error) return value;
      print(error);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Cancelled();
    throw error;
  } finally {
    reader.close();
    input.pause();
  }
}
