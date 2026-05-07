---
name: react-scan-cli
description: Set up react-scan-cli in a Vite + React project. Guides the user through plugin installation, vite.config.ts configuration, GitHub Actions workflow setup, and secret configuration. Use when the user wants to detect React re-render issues automatically.
argument-hint: "[setup|plugin|workflow]"
allowed-tools: Read, Edit, Write, Glob, Bash
---

# react-scan-cli Setup

You are helping the user integrate `@react-scan-cli/vite-plugin` into their project.

The tool automatically detects React re-render issues via Playwright, then writes results to GitHub Issues — no extra server needed.

## Full flow (for your reference)

```
Vite plugin (injected script)
  └─ detects re-renders via react-scan → writes window.__renderInspector__

GitHub Actions (weekly or manual)
  └─ @react-scan-cli/runner
  └─ Playwright visits each page with cookie __render_inspector__=true
  └─ reads window.__renderInspector__ → creates/updates GitHub Issues
```

---

## Step 0 — Understand what the user wants

If `$ARGUMENTS` is empty, ask:

> Which part do you need help with?
> 1. **Full setup** — first time, walk me through everything
> 2. **Plugin only** — just add the Vite plugin to my project
> 3. **GitHub Actions only** — the plugin is installed, I need the CI side

Then proceed to the matching section below.

---

## Step 1 — Check current state

Run these reads in parallel before making any changes:

- Look for `vite.config.ts` or `vite.config.js` with `Glob("vite.config.*")`
- Read the found config file
- Check if `@react-scan-cli/vite-plugin` is already in `package.json`
- Check if `.github/workflows/` exists and has any related workflow

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

Read the existing vite config. Add `renderInspector()` to the plugins array:

```ts
import { renderInspector } from '@react-scan-cli/vite-plugin';

// inside defineConfig:
plugins: [
  // ... existing plugins ...
  renderInspector({
    threshold: 5,      // report components that re-render more than N times
    enableInDev: true, // highlight re-renders in dev mode automatically
  }),
]
```

**Rules:**
- Preserve all existing plugins — never remove them
- Add the import at the top with other imports
- If the React plugin is present, place `renderInspector()` after it
- If the config uses `export default {}` (no defineConfig), still add correctly

After editing, show the diff and ask the user to confirm.

---

## Step 4 — Gather GitHub Actions configuration

Ask the user the following questions (can be asked all at once):

1. **Project name** — label for issues (e.g. `my-app`)
2. **Base URL** — deployed URL of the app (e.g. `https://example.com`)
3. **Issue repo** — GitHub repo to receive issues, format `owner/repo`
   - Tip: a dedicated repo like `your-org/perf-issues` keeps things clean
4. **Pages to check** — paths to monitor with display names:
   ```
   / → Home
   /dashboard → Dashboard
   /profile → Profile
   ```
5. **Auth required?** — do any pages require login? If yes, note it — they'll need a custom `authSetup` function (advanced, out of scope here).
6. **Observe duration** — seconds to watch each page (default: 8; increase for data-heavy pages)

---

## Step 5 — Copy the workflow file

Check if `.github/workflows/` exists. If not, create it.

Write `.github/workflows/render-check.yml`:

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

---

## Step 6 — Generate secret values

Using the answers from Step 4, produce the two GitHub secret values.

### REACT_SCAN_TOKEN
Tell the user:
> Create a GitHub Fine-grained Personal Access Token with **Issues: Read and write** on the `<issue_repo>` repository.
> GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens

### REACT_SCAN_CONFIG
Generate the JSON:

```json
{
  "projectName": "<project_name>",
  "baseUrl": "<base_url>",
  "issueRepo": "<issue_repo>",
  "observeDuration": <seconds * 1000>,
  "threshold": 5,
  "pages": [
    { "name": "<display_name>", "url": "<path>" }
  ]
}
```

Show the generated JSON for the user to verify, then tell them:
> **Settings → Secrets and variables → Actions → New repository secret**
> Add `REACT_SCAN_TOKEN` and `REACT_SCAN_CONFIG`.

---

## Step 7 — Verify and summarize

Re-read `vite.config.ts` and `.github/workflows/render-check.yml` to confirm they look correct, then print:

```
✅ @react-scan-cli/vite-plugin installed
✅ vite.config.ts configured
✅ .github/workflows/render-check.yml created
⬜ Issue repo created: <issue_repo>        ← create this if it doesn't exist
⬜ REACT_SCAN_TOKEN secret added           ← add in repo Settings → Secrets
⬜ REACT_SCAN_CONFIG secret added          ← add in repo Settings → Secrets
```

Then tell the user:
> Once secrets are set, go to **Actions → React Re-render Check → Run workflow** to trigger a manual run.

---

## Edge cases

- **Monorepo**: Multiple `vite.config.*` found — ask which app to configure.
- **Already configured**: `renderInspector` already in config — skip Step 3.
- **Workflow already exists**: Show a diff and ask before overwriting.
- **No Vite config**: Ask if this is a Vite project; if not, explain the plugin only works with Vite.
