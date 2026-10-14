// Lists every line Vexahl can say (all variants of {village}) as JSON on stdout.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/rival/data.ts', import.meta.url), 'utf8');
const RIVAL_NAME = 'Vexahl', RIVAL_TITLE = 'Lord of the Far Shore';
const villages = [...fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8').matchAll(/\{ name: '([^']+)', x:/g)].map((m) => m[1]);
const out = new Set();
for (const m of src.matchAll(/L\('rival',\s*('(?:[^'\\]|\\.)*'|`[^`]*`)\)/g)) {
  const text = eval(m[1]);
  if (text.includes('{village}')) villages.forEach((v) => out.add(text.replace(/\{village\}/g, v)));
  else out.add(text);
}
console.log(JSON.stringify([...out].map((text) => ({ who: 'rival', text })), null, 1));
