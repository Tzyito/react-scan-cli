#!/usr/bin/env bun
// 验证 vite-plugin 生成的注入脚本内容是否正确
import { buildInjectScript } from '../packages/vite-plugin/src/inject';

const script = buildInjectScript({
  triggerCookie: '__render_inspector__',
  threshold: 5,
  enableInDev: true,
});

console.log('=== 生成的注入脚本 ===\n');
console.log(script);

// 基本断言
const checks = [
  ['包含 react-scan import', script.includes("from 'react-scan'")],
  ['包含 cookie 检查', script.includes('__render_inspector__=true')],
  ['包含 window.__renderInspector__', script.includes('window.__renderInspector__')],
  ['包含 onRender 回调', script.includes('onRender')],
  ['包含 threshold 值', script.includes('threshold: 5')],
];

console.log('\n=== 检查项 ===');
let pass = true;
for (const [label, result] of checks) {
  const icon = result ? '✓' : '✗';
  console.log(`${icon} ${label}`);
  if (!result) pass = false;
}

process.exit(pass ? 0 : 1);
