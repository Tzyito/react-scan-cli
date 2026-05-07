import { run } from './index';
import type { RunnerConfig } from './types';

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const rawConfig = process.env.RI_CONFIG;

  if (!githubToken) {
    console.error('[react-scan-cli] 错误：缺少 GITHUB_TOKEN 环境变量');
    process.exit(1);
  }

  if (!rawConfig) {
    console.error('[react-scan-cli] 错误：缺少 RI_CONFIG 环境变量');
    process.exit(1);
  }

  let config: Omit<RunnerConfig, 'githubToken'>;
  try {
    config = JSON.parse(rawConfig);
  } catch {
    console.error('[react-scan-cli] 错误：RI_CONFIG 不是合法的 JSON');
    process.exit(1);
  }

  await run({ ...config, githubToken });
}

main().catch(err => {
  console.error('[react-scan-cli] 运行失败：', err);
  process.exit(1);
});
