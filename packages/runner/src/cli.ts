import { run } from './index';
import type { RunnerConfig } from './types';

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const rawConfig = process.env.RI_CONFIG;

  if (!githubToken) {
    console.error('[react-scan-cli] error: GITHUB_TOKEN is not set');
    process.exit(1);
  }

  if (!rawConfig) {
    console.error('[react-scan-cli] error: RI_CONFIG is not set');
    process.exit(1);
  }

  let config: Omit<RunnerConfig, 'githubToken'>;
  try {
    config = JSON.parse(rawConfig);
  } catch {
    console.error('[react-scan-cli] error: RI_CONFIG is not valid JSON');
    process.exit(1);
  }

  await run({ ...config, githubToken });
}

main().catch(err => {
  console.error('[react-scan-cli] fatal:', err);
  process.exit(1);
});
