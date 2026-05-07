import path from 'path';
import type { NextConfig } from 'next';

export interface RenderInspectorOptions {
  triggerCookie?: string;
  threshold?: number;
  enableInDev?: boolean;
}

export function withRenderInspector(
  nextConfig: NextConfig = {},
  options: RenderInspectorOptions = {},
): NextConfig {
  const {
    triggerCookie = '__render_inspector__',
    threshold = 5,
    enableInDev = true,
  } = options;

  return {
    ...nextConfig,
    env: {
      ...nextConfig.env,
      NEXT_PUBLIC_RSC_COOKIE:     triggerCookie,
      NEXT_PUBLIC_RSC_THRESHOLD:  String(threshold),
      NEXT_PUBLIC_RSC_DEV:        String(enableInDev),
    },
    webpack(config, ctx) {
      if (!ctx.isServer) {
        const injectPath = path.resolve(__dirname, 'inject-entry.js');
        const originalEntry = config.entry;

        config.entry = async () => {
          const entries = typeof originalEntry === 'function'
            ? await originalEntry()
            : originalEntry;

          // App Router uses 'main-app', Pages Router uses 'main'
          for (const target of ['main-app', 'main']) {
            if (!entries[target]) continue;
            const list: string[] = Array.isArray(entries[target])
              ? entries[target]
              : entries[target].import ?? [];
            if (!list.includes(injectPath)) {
              list.unshift(injectPath);
              if (Array.isArray(entries[target])) {
                entries[target] = list;
              } else {
                entries[target].import = list;
              }
            }
          }
          return entries;
        };
      }

      // Preserve user's existing webpack config
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, ctx);
      }
      return config;
    },
  };
}
