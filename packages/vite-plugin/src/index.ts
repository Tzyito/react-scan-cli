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
    // enforce: 'pre' 让脚本在 Vite 内置 HTML transform 之前注入，
    // Vite 才会处理脚本里的裸模块 import
    transformIndexHtml: {
      enforce: 'pre',
      transform() {
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
