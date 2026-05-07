---
name: react-scan-cli
description: Set up react-scan-cli in a Vite + React project. Guides the user through plugin installation, vite.config.ts configuration, CI/CD workflow setup (GitHub Actions or GitLab CI), and secret configuration. Use when the user wants to detect React re-render issues automatically.
argument-hint: "[setup|plugin|workflow]"
allowed-tools: Read, Edit, Write, Glob, Bash
---

# react-scan-cli Setup

You are helping the user integrate `@react-scan-cli/vite-plugin` into their project.

The tool automatically detects React re-render issues via Playwright, then writes results to GitHub Issues or GitLab Issues — no extra server needed.

## Full flow (for your reference)

```
Vite plugin (injected script)
  └─ detects re-renders via react-scan → writes window.__renderInspector__

CI pipeline (weekly or manual)
  └─ @react-scan-cli/runner
  └─ Playwright visits each page with cookie __render_inspector__=true
  └─ reads window.__renderInspector__ → creates/updates GitHub or GitLab Issues
```

Pages are **auto-discovered** by crawling links from `baseUrl` if the user does not specify them explicitly.

---

## Step 0 — Understand what the user wants

If `$ARGUMENTS` is empty, ask:

> Which part do you need help with?
> 1. **Full setup** — first time, walk me through everything
> 2. **Plugin only** — just add the Vite plugin to my project
> 3. **CI only** — the plugin is installed, I need the CI/CD side

Then proceed to the matching section below.

---

## Step 1 — Check current state

Run these reads in parallel before making any changes:

- Look for `vite.config.ts` or `vite.config.js` with `Glob("vite.config.*")`
- Read the found config file
- Check if `@react-scan-cli/vite-plugin` is already in `package.json`
- Check if `.github/workflows/` or `.gitlab-ci.yml` exists

Tell the user what you found before proceeding.

---

## Step 2 — Install the plugin

If `@react-scan-cli/vite-plugin` is not in `package.json`, detect the package manager first:

- `bun.lockb` present → bun
- `pnpm-lock.yaml` present → pnpm
- `yarn.lock` present → yarn
- otherwise → npm

Then tell the user to run:

```bash
# bun
bun add -d @react-scan-cli/vite-plugin

# npm
npm install -D @react-scan-cli/vite-plugin

# pnpm
pnpm add -D @react-scan-cli/vite-plugin
```

Wait for confirmation before continuing.

---

## Step 3 — Configure vite.config.ts

Read the existing vite config. Add `reactScanPlugin()` to the plugins array:

```ts
import { reactScanPlugin } from '@react-scan-cli/vite-plugin';

// inside defineConfig:
plugins: [
  // ... existing plugins ...
  reactScanPlugin({
    threshold: 5,      // report components that re-render more than N times
    enableInDev: true, // highlight re-renders in dev mode automatically
  }),
]
```

**Rules:**
- Preserve all existing plugins — never remove them
- Add the import at the top with other imports
- If the React plugin is present, place `reactScanPlugin()` after it
- If the config uses `export default {}` (no defineConfig), still add correctly

After editing, show the diff and ask the user to confirm.

---

## Step 4 — Choose provider and gather CI configuration

### 4a — Choose provider

Ask the user:

> Which platform hosts your issues?
> 1. **GitHub** (github.com or GitHub Enterprise)
> 2. **GitLab** (gitlab.com or self-hosted GitLab)

### 4b — Common questions (ask all at once)

1. **Project name** — label for issues (e.g. `my-app`)
2. **Base URL** — deployed URL of the app (e.g. `https://example.com`)
3. **Pages to check** — leave blank to auto-discover from base URL, or list paths:
   ```
   / → Home
   /dashboard → Dashboard
   /profile → Profile
   ```
4. **Auth required?** — do any pages require login?
5. **Observe duration** — seconds to watch each page (default: 8)

### 4c — Provider-specific questions

**If GitHub:**
- Issue repo — GitHub repo to receive issues, format `owner/repo`
  - Tip: a dedicated repo like `your-org/perf-issues` keeps things clean

**If GitLab:**
- GitLab project — format `namespace/project` (e.g. `my-org/my-app`)
- GitLab base URL — leave blank for `https://gitlab.com`, or enter your self-hosted URL (e.g. `https://gitlab.mycompany.com`)

---

## Step 5 — Write the CI workflow file

### GitHub Actions — `.github/workflows/render-check.yml`

```yaml
name: React Re-render Check

on:
  schedule:
    - cron: '0 2 * * 1'   # Every Monday at 2am UTC
  workflow_dispatch:        # Allow manual trigger

jobs:
  render-check:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install runner
        run: bun install -g @react-scan-cli/runner

      - name: Install Playwright Chromium
        run: bunx playwright install chromium --with-deps

      - name: Run check
        run: react-scan-cli run
        env:
          GITHUB_TOKEN: ${{ secrets.REACT_SCAN_TOKEN }}
          RI_CONFIG: ${{ secrets.REACT_SCAN_CONFIG }}
```

### GitLab CI — `.gitlab-ci.yml`

```yaml
react-scan:
  image: node:20-slim
  stage: test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
    - if: '$CI_PIPELINE_SOURCE == "web"'     # allow manual trigger
  before_script:
    - npm install -g bun
    - bun install -g @react-scan-cli/runner
    - bunx playwright install chromium --with-deps
  script:
    - react-scan-cli run
  variables:
    GITLAB_TOKEN: $REACT_SCAN_TOKEN
    RI_CONFIG: $REACT_SCAN_CONFIG
  timeout: 30 minutes
```

To schedule it in GitLab: **CI/CD → Schedules → New schedule** (e.g. every Monday `0 2 * * 1`).

---

## Step 6 — Generate secret values

### REACT_SCAN_CONFIG

Using the answers from Step 4, produce the JSON. If the user left pages blank, omit the `pages` field entirely (auto-discovery will run):

**GitHub example:**
```json
{
  "projectName": "<project_name>",
  "baseUrl": "<base_url>",
  "provider": "github",
  "issueRepo": "<owner/repo>",
  "observeDuration": <seconds * 1000>,
  "threshold": 5
}
```

**GitLab example (with auto page discovery):**
```json
{
  "projectName": "<project_name>",
  "baseUrl": "<base_url>",
  "provider": "gitlab",
  "gitlabProject": "<namespace/project>",
  "gitlabBaseUrl": "<https://gitlab.mycompany.com or omit for gitlab.com>",
  "observeDuration": <seconds * 1000>,
  "threshold": 5,
  "maxPages": 20
}
```

Show the generated JSON for the user to verify.

### REACT_SCAN_TOKEN

**GitHub:**
> Create a Fine-grained Personal Access Token with **Issues: Read and write** on the `<issue_repo>` repository.
> GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens

**GitLab:**
> Create a Personal Access Token with `api` scope.
> GitLab → User Settings → Access Tokens → Add new token

Then tell the user where to add the secret:
- **GitHub:** Settings → Secrets and variables → Actions → New repository secret
- **GitLab:** Settings → CI/CD → Variables → Add variable (mask the value)

---

## Step 7 — Verify and summarize

Re-read the config file and workflow to confirm they look correct, then print the appropriate checklist:

**GitHub:**
```
✅ @react-scan-cli/vite-plugin installed
✅ vite.config.ts configured
✅ .github/workflows/render-check.yml created
⬜ Issue repo created: <issue_repo>        ← create if it doesn't exist
⬜ REACT_SCAN_TOKEN secret added           ← Settings → Secrets → Actions
⬜ REACT_SCAN_CONFIG secret added          ← Settings → Secrets → Actions
```

**GitLab:**
```
✅ @react-scan-cli/vite-plugin installed
✅ vite.config.ts configured
✅ .gitlab-ci.yml created
⬜ REACT_SCAN_TOKEN CI variable added      ← Settings → CI/CD → Variables
⬜ REACT_SCAN_CONFIG CI variable added     ← Settings → CI/CD → Variables
⬜ Pipeline schedule created               ← CI/CD → Schedules
```

Then tell the user:
> Once secrets are set, trigger a manual run to verify everything works end-to-end.
> - **GitHub:** Actions → React Re-render Check → Run workflow
> - **GitLab:** CI/CD → Pipelines → Run pipeline (or Schedules → Run)

---

## Edge cases

- **Monorepo**: Multiple `vite.config.*` found — ask which app to configure.
- **Already configured**: `reactScanPlugin` already in config — skip Step 3.
- **Workflow already exists**: Show a diff and ask before overwriting.
- **No Vite config**: Ask if this is a Vite project; if not, explain the plugin only works with Vite.
- **Self-hosted GitLab**: Always ask for `gitlabBaseUrl` if provider is GitLab.
- **Pages auto-discovery**: If the user is unsure what pages to list, reassure them that leaving `pages` blank will auto-crawl from `baseUrl` up to `maxPages` (default 20).
