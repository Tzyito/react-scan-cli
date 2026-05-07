import { run } from './index';
import type { RunnerConfig } from './types';

async function main() {
  const rawConfig = process.env.RI_CONFIG;

  if (!rawConfig) {
    console.error('[react-scan-cli] error: RI_CONFIG is not set');
    process.exit(1);
  }

  let config: RunnerConfig;
  try {
    config = JSON.parse(rawConfig);
  } catch {
    console.error('[react-scan-cli] error: RI_CONFIG is not valid JSON');
    process.exit(1);
  }

  const provider = config.provider ?? 'github';

  // Inject tokens from environment — env vars take precedence over config
  if (provider === 'gitlab') {
    const gitlabToken = process.env.GITLAB_TOKEN ?? config.gitlabToken;
    if (!gitlabToken) {
      console.error('[react-scan-cli] error: GITLAB_TOKEN is not set');
      process.exit(1);
    }
    config = { ...config, gitlabToken };
  } else {
    const githubToken = process.env.GITHUB_TOKEN ?? config.githubToken;
    if (!githubToken) {
      console.error('[react-scan-cli] error: GITHUB_TOKEN is not set');
      process.exit(1);
    }
    config = { ...config, githubToken };
  }

  await run(config);
}

main().catch(err => {
  console.error('[react-scan-cli] fatal:', err);
  process.exit(1);
});
