---
name: react-scan-patrol
description: Interactively guide the user to configure functional inspection (interactions + assertions) for react-scan-cli. Ask about their key pages and user flows, generate the RI_CONFIG JSON, then loop until the user is satisfied. Use when the user wants to set up scheduled UI smoke tests or patrol checks.
argument-hint: "[page url or flow description]"
allowed-tools: Read, Glob, Bash
---

# react-scan-cli — Functional Patrol Setup

You are helping the user configure **functional inspection** for their project using react-scan-cli.

Functional inspection = simulating real user interactions on key pages, then asserting that the result matches expectations. Failures are automatically reported as GitHub / GitLab Issues.

Your job is to **have a conversation** with the user to understand their pages and flows, then generate the `pages` array (with `interactions` and `assertions`) that goes inside `RI_CONFIG`.

---

## Your working style

- Ask one focused question at a time — don't dump a long form at the user
- After getting enough info for a page, **generate the config immediately** and show it
- After showing each page's config, ask: "Does this look right? Want to adjust anything, or move on to the next page?"
- This is the reloop: keep refining until the user says it's good
- When all pages are done, output the complete `RI_CONFIG` JSON

---

## Phase 0 — Understand the project

If `$ARGUMENTS` is empty, start here. Otherwise skip to Phase 1 using `$ARGUMENTS` as context.

Read `package.json` and look for routing clues:
- Glob for `src/app/**/page.tsx` (Next.js App Router)
- Glob for `src/pages/**/*.tsx` (Next.js Pages Router or similar)
- Glob for `src/router*`, `src/routes*` (Vite + react-router)

Then ask:

> I'll help you set up automated functional inspection for your pages. A few quick questions:
>
> 1. What's the deployed URL of your app? (e.g. `https://example.com`)
> 2. Which platform do you use for issues — **GitHub** or **GitLab**?
> 3. Which pages are most critical to monitor? List them, or I can suggest based on the routes I found.

---

## Phase 1 — Build the page list

For each page the user wants to monitor, go through the flow below **one page at a time**.

### 1a — Understand the page

Ask:

> Tell me about **[page name]** (`[url]`):
> - What's the main thing a user does on this page?
> - Are there any key elements that must be present when it loads?
> - Is there a specific flow you want to verify (e.g. clicking a button, submitting a form, navigating somewhere)?

Listen carefully. Common patterns to recognize:

| User says | Likely flow |
|-----------|------------|
| "user logs in" | fill email + password → click submit → assert URL or dashboard element |
| "search for something" | fill search input → wait for results → assert results visible |
| "click a tab / filter" | click tab → wait → assert new content appears |
| "open a modal / dialog" | click trigger → assert dialog visible |
| "add to cart / place order" | click button → assert confirmation element or URL |
| "infinite scroll / load more" | scroll down → assert new items appear |
| "auth-gated page" | note it needs `authSetup` — skip assertions, remind user to configure `authSetup` manually |

### 1b — Ask about selectors (only if needed)

If the flow is clear but you need element selectors, ask specifically:

> What's the CSS selector for [the button / input / result container]?
> (class name, `data-testid`, `aria-label`, or any unique attribute works)

Prefer in this order: `data-testid` > `aria-label` > semantic role (`[role=dialog]`) > class name.

If the user doesn't know, generate a reasonable guess using common patterns and **label it clearly as a guess**:
```json
{ "type": "click", "selector": ".buy-btn", "description": "⚠️ selector is a guess — verify in DevTools" }
```

### 1c — Generate the page config

Based on what you learned, produce the page config block:

```json
{
  "name": "Page Name",
  "url": "/path",
  "interactions": [
    // ordered list of user actions
  ],
  "assertions": [
    // what must be true after interactions
  ]
}
```

**Interaction types:**

| type | required fields | what it does |
|------|----------------|--------------|
| `scroll` | `scrollY` (0–1 = % of page, >1 = px) | smooth scroll |
| `click` | `selector` | click element |
| `hover` | `selector` | hover (triggers tooltips/dropdowns) |
| `fill` | `selector`, `value` | type text into input |
| `wait` | `ms` | fixed pause |
| `waitForSelector` | `selector`, `waitMs` | wait until element appears |

**Assertion types:**

| type | required fields | what it checks |
|------|----------------|----------------|
| `url` | `expected` | current URL contains value |
| `visible` | `selector` | element is visible in viewport |
| `hidden` | `selector` | element is absent or hidden |
| `text` | `selector`, `contains` | element's text contains value |
| `count` | `selector`, `expected` | number of matching elements |

**Rules for generating:**
- Always add `waitForSelector` or `wait` after async-triggering actions (clicks that load data)
- Keep total interaction time under `observeDuration - 2000ms`
- Prefer asserting the **outcome** (URL changed, success element visible) not intermediate states
- Add `description` to every interaction step for readable CI logs
- Assertions should be the minimum set that proves the flow worked

**Example — login flow:**
```json
{
  "name": "Login Flow",
  "url": "/login",
  "interactions": [
    { "type": "fill", "selector": "#email", "value": "test@example.com", "description": "enter email" },
    { "type": "fill", "selector": "#password", "value": "test-password", "description": "enter password" },
    { "type": "click", "selector": "[type=submit]", "description": "submit login form" },
    { "type": "wait", "ms": 2000, "description": "wait for redirect" }
  ],
  "assertions": [
    { "type": "url", "expected": "/dashboard" },
    { "type": "visible", "selector": ".user-avatar" }
  ]
}
```

**Example — search flow:**
```json
{
  "name": "Search",
  "url": "/search",
  "interactions": [
    { "type": "fill", "selector": "input[type=search]", "value": "apple", "description": "enter search query" },
    { "type": "waitForSelector", "selector": ".search-results", "waitMs": 3000, "description": "wait for results" }
  ],
  "assertions": [
    { "type": "visible", "selector": ".search-results" },
    { "type": "count", "selector": ".result-item", "expected": 5 }
  ]
}
```

### 1d — Reloop

After showing the generated page config, ask:

> Does this look right for **[page name]**?
> - Say **yes** to move to the next page
> - Tell me what to change and I'll update it
> - Say **skip** if you don't want assertions for this page

If the user requests changes, update the config and show it again. Repeat until they confirm.

---

## Phase 2 — Assemble the complete config

Once all pages are confirmed, produce the full `RI_CONFIG`:

```json
{
  "projectName": "<project_name>",
  "baseUrl": "<base_url>",
  "provider": "github",
  "issueRepo": "<owner/repo>",
  "observeDuration": 10000,
  "threshold": 5,
  "pages": [
    // all confirmed page configs here
  ]
}
```

Notes:
- Use `"provider": "gitlab"` + `"gitlabProject"` if the user chose GitLab
- Set `observeDuration` to at least `max(total interaction time per page) + 3000ms`
- Pages without assertions still get re-render detection automatically

Show the full JSON and say:

> Copy this into your `REACT_SCAN_CONFIG` repository variable (Settings → Secrets and variables → Actions → Variables).
>
> Want to add more pages, adjust anything, or are we done?

If the user wants to add pages or make changes, go back to Phase 1 for the new page / change. Otherwise close out.

---

## Phase 3 — Closing checklist

Print only what's relevant:

```
✅ Pages configured: <N> pages
✅ RI_CONFIG generated

⬜ Add REACT_SCAN_CONFIG to repository variables
⬜ Verify selectors in browser DevTools for any ⚠️ guessed selectors
⬜ Configure authSetup if any pages require login (see README)
⬜ Trigger a manual workflow run to validate end-to-end
```

---

## Edge cases

- **User doesn't know selectors**: Generate a best-guess, mark it with ⚠️, and tell them to verify in DevTools (`F12 → Elements → right click element → Copy selector`)
- **Auth-gated pages**: Note that `authSetup` must be configured in code (not JSON), point to the README example; skip assertions for that page unless the user provides a test account
- **"Just check the page loads"**: Generate a simple page with only `visible` assertions on a key landmark element, no interactions
- **User wants to check that nothing breaks (no specific flow)**: Suggest scroll interactions + assert key elements visible — this is a basic smoke test
- **User says "I don't know what selectors to use"**: Ask them to open the page, right-click the element they care about, and paste what DevTools shows
