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
    version: '1.0.0',
    page: location.pathname,
    startTime: Date.now(),
    threshold: ${opts.threshold},
    components: {},
  };

  scan({
    enabled: true,
    // only show toolbar in dev mode when triggered manually (no cookie)
    showToolbar: isDev && !hasCookie,
    log: false,
    onRender(fiber, renders) {
      const name =
        fiber.type?.displayName ||
        fiber.type?.name ||
        null;

      // skip anonymous and React-internal components
      if (!name || name.startsWith('_') || name === 'Anonymous') return;

      const data = window.__renderInspector__.components;
      if (!data[name]) {
        data[name] = { count: 0, reasons: [] };
      }

      data[name].count += renders.length;

      renders.forEach(r => {
        r.changes?.forEach(change => {
          const reason = change.type + ':' + change.name;
          if (!data[name].reasons.includes(reason)) {
            data[name].reasons.push(reason);
          }
        });
      });
    },
  });
})();
  `.trim();
}
