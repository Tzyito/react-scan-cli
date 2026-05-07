import type { Plugin } from 'vite';
import type { RenderInspectorOptions } from './types';
import { buildInjectScript } from './inject';

export function renderInspector(options: RenderInspectorOptions = {}): Plugin {
  const config = {
    triggerCookie: '__render_inspector__',
    threshold: 5,
    enableInDev: true,
    ...options,
  };

  return {
    name: 'vite-plugin-react-scan-cli',
    // order: 'pre' — inject before Vite's built-in HTML transform so that
    // bare module imports (e.g. react-scan) inside the script are resolved
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: buildInjectScript(config),
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

export type { RenderInspectorOptions };
