import type { PageReport, IssueData, AssertionResult, Assertion } from './types';

const ICON = { high: '🔴', medium: '🟡', low: '🟢' };
const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const REASON_LABEL: Record<string, string> = {
  props: 'Props change',
  state: 'State change',
  context: 'Context change',
};

function fmtTime(ms: number | null): string {
  if (ms == null) return 'N/A';
  return `${ms.toFixed(1)} ms`;
}

function fmtFps(fps: number | null): string {
  if (fps == null) return 'N/A';
  const flag = fps < 30 ? ' ⚠️' : fps < 60 ? ' ⚡' : '';
  return `${Math.round(fps)} fps${flag}`;
}

function fmtReasons(reasons: string[]): string {
  return reasons.map(r => {
    const [type, ...rest] = r.split(':');
    const label = REASON_LABEL[type] ?? type;
    const name = rest.join(':');
    return name ? `\`${label}: ${name}\`` : `\`${label}\``;
  }).join(', ') || 'unknown';
}

function buildChangesTable(issue: IssueData): string {
  if (!issue.changes || issue.changes.length === 0) return '';
  const rows = issue.changes.slice(0, 5).map(c =>
    `| \`${c.type}\` | \`${c.name}\` | \`${c.prevValue ?? '—'}\` | \`${c.value ?? '—'}\` |`
  );
  return `
**Change details** (last snapshot, up to 5 entries)

| Type | Name | Previous | Current |
|------|------|----------|---------|
${rows.join('\n')}
`;
}

function getSuggestion(issue: IssueData): string {
  const lines: string[] = [];
  const { reasons } = issue;

  if (reasons.some(r => r.startsWith('props'))) {
    lines.push(
      '- Wrap with `React.memo()` to skip re-renders when props are shallowly equal',
      '- Stabilize reference props: `useMemo` for objects/arrays, `useCallback` for functions',
    );
  }
  if (reasons.some(r => r.startsWith('context'))) {
    lines.push(
      '- Context value object is recreated on every parent render — add `useMemo`',
      '- Split large contexts into smaller ones so only affected consumers re-render',
    );
  }
  if (reasons.some(r => r.startsWith('state'))) {
    lines.push(
      '- High-frequency state updates (timers, WebSocket) — throttle/debounce to ≥200 ms',
      '- Batch related state with `useReducer` to avoid cascading renders',
    );
  }
  if (issue.unnecessaryCount > 0) {
    const pct = Math.round((issue.unnecessaryCount / issue.count) * 100);
    lines.push(
      `- **${pct}% of renders were unnecessary** — component re-rendered with identical props/state`,
      '- Add `React.memo()` or fix unstable references in the parent',
    );
  }
  if (issue.avgTime != null && issue.avgTime > 16) {
    lines.push(`- Avg render time ${issue.avgTime} ms exceeds 16 ms budget — profile with React DevTools Profiler`);
  }
  if (issue.minFps != null && issue.minFps < 60) {
    lines.push(`- FPS dropped to ${Math.round(issue.minFps)} — consider virtualizing long lists or moving heavy work off the main thread`);
  }
  if (lines.length === 0) {
    lines.push('- Open React DevTools Profiler → record → check "Why did this render?"');
  }
  return lines.join('\n');
}

function fmtAssertion(a: Assertion): string {
  switch (a.type) {
    case 'url':     return `URL contains \`${a.expected}\``;
    case 'visible': return `\`${a.selector}\` is visible`;
    case 'hidden':  return `\`${a.selector}\` is hidden`;
    case 'text':    return `\`${a.selector}\` contains text \`${a.contains}\``;
    case 'count':   return `\`${a.selector}\` count = ${a.expected}`;
  }
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildRenderSection(report: PageReport): string {
  if (report.issues.length === 0) return '';
  return `
## 🔁 重渲染问题

${report.issues.map((issue, idx) => `
### ${idx + 1}. ${ICON[issue.severity]} \`${issue.component}\`

| Metric | Value |
|--------|-------|
| Re-renders | **${issue.count}** |
| Severity | ${SEVERITY_LABEL[issue.severity]} |
| Avg render time | ${fmtTime(issue.avgTime)} |
| Min FPS | ${fmtFps(issue.minFps)} |
| Unnecessary | ${issue.unnecessaryCount} (${issue.count > 0 ? Math.round(issue.unnecessaryCount / issue.count * 100) : 0}%) |
| Triggered by | ${fmtReasons(issue.reasons)} |
${buildChangesTable(issue)}
**Suggestions**

${getSuggestion(issue)}
`).join('\n---\n')}`;
}

function buildJsErrorSection(report: PageReport): string {
  if (report.jsErrors.length === 0) return '';
  const rows = report.jsErrors.map((e, i) =>
    `**${i + 1}.** \`${e.message}\`\n\`\`\`\n${e.stack.split('\n').slice(0, 5).join('\n')}\n\`\`\``
  ).join('\n\n');
  return `
## 💥 代码报错

> ${report.jsErrors.length} uncaught JavaScript exception(s) detected during scan.

${rows}`;
}

function buildApiErrorSection(report: PageReport): string {
  if (report.apiErrors.length === 0) return '';
  const rows = report.apiErrors.map(e =>
    `| \`${e.method}\` | \`${e.url}\` | **${e.status}** |`
  ).join('\n');
  return `
## 🌐 接口报错

> ${report.apiErrors.length} failed request(s) from the same origin detected.

| Method | URL | Status |
|--------|-----|--------|
${rows}`;
}

function buildAuthFailureSection(report: PageReport): string {
  if (!report.authFailure) return '';
  return `
## 🔐 登录失败

> Authentication did not complete successfully during this scan.

**Error:** \`${report.authFailure}\`

**Possible causes**
- Test credentials are invalid or expired
- Login form selector has changed
- Login endpoint returned an error
- Post-login redirect did not occur`;
}

function buildAssertionSection(report: PageReport): string {
  if (report.assertionFailures.length === 0) return '';
  const rows = report.assertionFailures.map((r, i) => {
    const expected = fmtAssertion(r.assertion);
    const actual = r.actual ?? 'N/A';
    return `| ${i + 1} | ${expected} | \`${actual}\` |`;
  }).join('\n');
  return `
## 📋 数据展示不全

> ${report.assertionFailures.length} assertion(s) failed — expected UI state was not reached.

| # | Expected | Actual |
|---|----------|--------|
${rows}`;
}

// ── Snapshot (stored as hidden comment for diff tracking) ─────────────────────

export interface ScanSnapshot {
  renders: number;
  renderComponents: string[];
  jsErrors: number;
  jsErrorComponents: string[];
  apiErrors: number;
  assertions: number;
  authFail: boolean;
  ts: string;
}

export function snapshotFromReport(report: PageReport): ScanSnapshot {
  return {
    renders:           report.issues.length,
    renderComponents:  report.issues.map(i => i.component),
    jsErrors:          report.jsErrors.length,
    jsErrorComponents: [...new Set(report.jsErrors.flatMap(e => e.components))],
    apiErrors:         report.apiErrors.length,
    assertions:        report.assertionFailures.length,
    authFail:          report.authFailure != null,
    ts:                report.timestamp,
  };
}

export function parseSnapshot(body: string | undefined | null): ScanSnapshot | null {
  if (!body) return null;
  const match = body.match(/<!-- scan-snapshot: ({.*?}) -->/s);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// ── Diff comment ──────────────────────────────────────────────────────────────

type Trend = '⬇️ 好转' | '⬆️ 变差' | '— 无变化' | '✅ 正常' | '⚠️ 新增';

function trend(prev: number | boolean, curr: number | boolean): Trend {
  const p = Number(prev);
  const c = Number(curr);
  if (p === 0 && c === 0) return '✅ 正常';
  if (p === 0 && c > 0)   return '⚠️ 新增';
  if (c < p)              return '⬇️ 好转';
  if (c > p)              return '⬆️ 变差';
  return '— 无变化';
}

function componentDiff(prev: string[], curr: string[]): string {
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  const removed = prev.filter(c => !currSet.has(c));
  const added   = curr.filter(c => !prevSet.has(c));
  const lines: string[] = [];
  if (removed.length > 0) lines.push(`  消失: \`${removed.join('` · `')}\``);
  if (added.length > 0)   lines.push(`  新增: \`${added.join('` · `')}\``);
  return lines.join('\n');
}

export function buildDiffComment(report: PageReport, prev: ScanSnapshot | null): string {
  const now = new Date(report.timestamp).toUTCString();
  const curr = snapshotFromReport(report);

  if (!prev) {
    const components = curr.renderComponents.length > 0
      ? `\n重渲染组件：\`${curr.renderComponents.join('` · `')}\`` : '';
    const jsComps = curr.jsErrorComponents.length > 0
      ? `\n报错疑似来自：\`${curr.jsErrorComponents.join('` · `')}\`` : '';
    const tags = buildIssueTitle(report, '').replace(/^\[.*?\] .* · /, '');
    return `🔍 **首次扫描 · ${now}**\n\n已建立基准，发现：${tags}${components}${jsComps}\n\nIssue 详情已更新。`;
  }

  const renderDiff  = componentDiff(prev.renderComponents,  curr.renderComponents);
  const jsDiff      = componentDiff(prev.jsErrorComponents, curr.jsErrorComponents);

  const rows = [
    ['🔁 重渲染',       `${prev.renders} 个组件`,   `${curr.renders} 个组件`,   trend(prev.renders,    curr.renders),    renderDiff],
    ['💥 代码报错',     `${prev.jsErrors}`,          `${curr.jsErrors}`,          trend(prev.jsErrors,   curr.jsErrors),   jsDiff],
    ['🌐 接口报错',     `${prev.apiErrors}`,          `${curr.apiErrors}`,          trend(prev.apiErrors,  curr.apiErrors),  ''],
    ['🔐 登录失败',     prev.authFail ? '是' : '否', curr.authFail ? '是' : '否', trend(prev.authFail,   curr.authFail),   ''],
    ['📋 数据展示不全', `${prev.assertions}`,         `${curr.assertions}`,         trend(prev.assertions, curr.assertions), ''],
  ];

  const tableRows = rows.map(([cat, p, c, t]) => `| ${cat} | ${p} | ${c} | ${t} |`).join('\n');
  const details = rows
    .filter(([,,,, diff]) => diff)
    .map(([cat,,,, diff]) => `**${cat}**\n${diff}`)
    .join('\n\n');

  return `🔄 **扫描更新 · ${now}**

| 分类 | 上次 | 本次 | 趋势 |
|------|------|------|------|
${tableRows}
${details ? `\n${details}\n` : ''}
Issue 详情已更新为最新数据。`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildIssueBody(report: PageReport, projectName: string): string {
  const sections = [
    buildRenderSection(report),
    buildJsErrorSection(report),
    buildApiErrorSection(report),
    buildAuthFailureSection(report),
    buildAssertionSection(report),
  ].filter(Boolean).join('\n\n---\n');

  return `<!-- page-url: ${report.url} -->
<!-- project: ${projectName} -->

## Page Info

| Project | Page | URL | Detected at | Observe duration |
|---------|------|-----|-------------|-----------------|
| \`${projectName}\` | ${report.page} | \`${report.url}\` | ${new Date(report.timestamp).toUTCString()} | ${report.observeDuration / 1000}s |
${sections}

---

## Screenshot

<img src="data:image/png;base64,${report.screenshotBase64}" width="800" alt="page screenshot" />

---
*Generated by [react-scan-cli](https://github.com/Tzyito/react-scan-cli) · Close this issue once fixed*
<!-- scan-snapshot: ${JSON.stringify(snapshotFromReport(report))} -->`.trim();
}

export function buildIssueTitle(report: PageReport, projectName: string): string {
  const tags: string[] = [];
  if (report.issues.length > 0)          tags.push(`重渲染×${report.issues.length}`);
  if (report.jsErrors.length > 0)        tags.push(`代码报错×${report.jsErrors.length}`);
  if (report.apiErrors.length > 0)       tags.push(`接口报错×${report.apiErrors.length}`);
  if (report.authFailure)                tags.push('登录失败');
  if (report.assertionFailures.length > 0) tags.push(`数据不全×${report.assertionFailures.length}`);
  const summary = tags.length > 0 ? tags.join(' · ') : 'issues detected';
  return `[${projectName}] ${report.page} · ${summary}`;
}
