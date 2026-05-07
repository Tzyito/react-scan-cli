// Injected as a webpack entry — runs in the browser before React mounts
import { scan } from 'react-scan';

if (typeof window !== 'undefined') {
  const COOKIE    = process.env.NEXT_PUBLIC_RSC_COOKIE    ?? '__render_inspector__';
  const THRESHOLD = Number(process.env.NEXT_PUBLIC_RSC_THRESHOLD ?? 5);
  const DEV_ON    = process.env.NEXT_PUBLIC_RSC_DEV !== 'false';
  const isDev     = process.env.NODE_ENV === 'development';

  const hasCookie = document.cookie.split(';').some(c => c.trim() === `${COOKIE}=true`);

  if (hasCookie || (isDev && DEV_ON)) {
    (window as any).__renderInspector__ = {
      version: '1.1.0',
      page: location.pathname,
      startTime: Date.now(),
      threshold: THRESHOLD,
      components: {},
    };

    function safeStringify(val: unknown): string {
      try {
        const s = JSON.stringify(val);
        if (!s) return String(val);
        return s.length > 120 ? s.slice(0, 120) + '…' : s;
      } catch {
        return '[unserializable]';
      }
    }

    const REASON_LABEL: Record<number, string> = { 1: 'props', 2: 'state', 3: 'state', 4: 'context' };

    scan({
      enabled: true,
      showToolbar: isDev && !hasCookie,
      log: false,
      onRender(fiber: any, renders: any[]) {
        const name: string | null =
          fiber.type?.displayName || fiber.type?.name || null;

        if (!name || name.startsWith('_') || name === 'Anonymous') return;

        const data = (window as any).__renderInspector__.components;
        if (!data[name]) {
          data[name] = { count: 0, unnecessaryCount: 0, totalTime: 0, minFps: null, reasons: [], changes: [] };
        }

        const entry = data[name];
        entry.count += renders.length;

        renders.forEach((r: any) => {
          if (r.time != null) entry.totalTime += r.time;
          if (r.fps != null && r.fps > 0) {
            if (entry.minFps === null || r.fps < entry.minFps) entry.minFps = r.fps;
          }
          if (r.unnecessary) entry.unnecessaryCount++;
          if (r.changes) {
            r.changes.forEach((change: any) => {
              const label = REASON_LABEL[change.type] || String(change.type);
              const reason = label + ':' + change.name;
              if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
              const exists = entry.changes.some((c: any) => c.type === label && c.name === change.name);
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
  }
}
