export function buildInjectScript(opts: {
  triggerCookie: string;
  threshold: number;
  enableInDev: boolean;
}): string {
  return `
import { scan } from 'react-scan';

(function() {
  const isDev = import.meta.env.DEV;
  const hasCookie = document.cookie
    .split(';')
    .some(c => c.trim() === '${opts.triggerCookie}=true');

  if (!hasCookie && !(isDev && ${opts.enableInDev})) return;

  window.__renderInspector__ = {
    version: '1.1.0',
    page: location.pathname,
    startTime: Date.now(),
    threshold: ${opts.threshold},
    components: {},
  };

  function safeStringify(val) {
    try {
      const s = JSON.stringify(val);
      if (!s) return String(val);
      return s.length > 120 ? s.slice(0, 120) + '…' : s;
    } catch {
      return '[unserializable]';
    }
  }

  // ChangeReason enum from react-scan
  const REASON_LABEL = { 1: 'props', 2: 'state', 3: 'state', 4: 'context' };

  scan({
    enabled: true,
    showToolbar: isDev && !hasCookie,
    log: false,
    onRender(fiber, renders) {
      const name =
        fiber.type?.displayName ||
        fiber.type?.name ||
        null;

      if (!name || name.startsWith('_') || name === 'Anonymous') return;

      const data = window.__renderInspector__.components;
      if (!data[name]) {
        data[name] = {
          count: 0,
          unnecessaryCount: 0,
          totalTime: 0,
          minFps: null,
          reasons: [],
          changes: [],
        };
      }

      const entry = data[name];
      entry.count += renders.length;

      renders.forEach(function(r) {
        // render duration
        if (r.time != null) entry.totalTime += r.time;

        // fps — track the minimum seen
        if (r.fps != null && r.fps > 0) {
          if (entry.minFps === null || r.fps < entry.minFps) {
            entry.minFps = r.fps;
          }
        }

        // unnecessary renders
        if (r.unnecessary) entry.unnecessaryCount++;

        // change reasons + details
        if (r.changes) {
          r.changes.forEach(function(change) {
            const label = REASON_LABEL[change.type] || String(change.type);
            const reason = label + ':' + change.name;

            if (!entry.reasons.includes(reason)) {
              entry.reasons.push(reason);
            }

            // keep at most one detail snapshot per (type, name) pair
            const exists = entry.changes.some(
              function(c) { return c.type === label && c.name === change.name; }
            );
            if (!exists) {
              entry.changes.push({
                type: label,
                name: change.name,
                prevValue: safeStringify(change.prevValue),
                value: safeStringify(change.value),
              });
            }
          });
        }
      });
    },
  });
})();
  `.trim();
}
