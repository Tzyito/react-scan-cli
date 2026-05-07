#!/usr/bin/env bun
// Verify that the vite-plugin generates a correct inject script
import { buildInjectScript } from '../packages/vite-plugin/src/inject';

const script = buildInjectScript({
  triggerCookie: '__render_inspector__',
  threshold: 5,
  enableInDev: true,
});

console.log('=== generated inject script ===\n');
console.log(script);

const checks: [string, boolean][] = [
  ['imports react-scan', script.includes("from 'react-scan'")],
  ['checks trigger cookie', script.includes('__render_inspector__=true')],
  ['sets window.__renderInspector__', script.includes('window.__renderInspector__')],
  ['registers onRender callback', script.includes('onRender')],
  ['embeds threshold value', script.includes('threshold: 5')],
];

console.log('\n=== checks ===');
let pass = true;
for (const [label, result] of checks) {
  console.log(`${result ? '✓' : '✗'} ${label}`);
  if (!result) pass = false;
}

process.exit(pass ? 0 : 1);
