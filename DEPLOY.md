# Deploy guide — GitHub + Vercel (password-protected)

This dashboard handles Avalara M&A Jira data. The deployment is gated by HTTP Basic Auth via a Vercel Edge Middleware (`middleware.ts`). Anyone hitting the URL gets a browser password prompt; the page never renders without valid credentials.

## What's in this repo

- `middleware.ts` — Vercel Edge Middleware that enforces Basic Auth on every request.
- `vercel.json` — declares Vite framework, build command, output dir.
- App code under `src/`.

## One-time setup

### 1. Push to GitHub

The `gh` CLI is bundled at `~/.local/share/dashboard-mna/bin/gh`. Easiest path is to auth gh once, which sets up git's credential helper automatically.

In **your own terminal** (Terminal.app or the Cursor terminal), run:

```bash
cd "/Users/deveshkumar.sharma/Library/CloudStorage/OneDrive-Avalara/Documents/Projects/Dashboard-MNA"
export PATH="$HOME/.local/share/dashboard-mna/bin:$PATH"

# Auth gh — opens browser, takes ~30 sec
gh auth login -p https -w

# Wire gh as git's credential helper
gh auth setup-git

# Create the private repo on GitHub AND push in one step
gh repo create AvaDevK/Dash-MnA --private --source=. --push
```

If `gh repo create` complains that the `origin` remote already exists, run `git remote remove origin` first and rerun the create.

Alternative (no gh): create the repo manually on https://github.com/new (Private), then:

```bash
git push -u origin main
```

…and use a [GitHub Personal Access Token](https://github.com/settings/tokens?type=beta) (fine-grained, repo `Contents: Read and write`) as the password when prompted.

### 2. Connect to Vercel

1. Open https://vercel.com/new
2. "Import Git Repository" → pick `AvaDevK/Dash-MnA`.
3. Framework: Vite (auto-detected). Leave build/output as defaults.
4. **Before clicking Deploy**, expand "Environment Variables" and add:
   - `DASH_USER` = `leadership` (or whatever username you want)
   - `DASH_PASSWORD` = a strong shared password
5. Click Deploy.

After ~1 min you'll get a URL like `https://dash-mn-a.vercel.app/`. Open it — you should see a browser auth prompt. Enter the user/password from step 4 to view the dashboard.

### 3. Share with leadership

Send the link AND the password via separate channels (e.g., link in email, password in Teams DM or Slack). Anyone with the URL still cannot view the data without the password.

## Live Jira pull (optional)

The dashboard ships with a serverless endpoint at `/api/jira-export` that runs a JQL query against Avalara Jira and returns CSV in the dashboard's schema. To enable it, add these env vars in Vercel → Project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `JIRA_BASE_URL` | `https://avalara.atlassian.net` |
| `JIRA_EMAIL` | The Atlassian account email the API token belongs to (use a service account if you have one). |
| `JIRA_API_TOKEN` | Create at https://id.atlassian.com/manage-profile/security/api-tokens. Token must have read access to the relevant projects. |

After adding the vars, redeploy. Then in the dashboard, click **Data Source → Live Jira**, type a JQL like:

```
issuekey = SBR-356 OR parent = SBR-356
```

…and hit **Pull from Jira**. The function paginates up to 5000 issues and returns CSV with one row per linked-issue. Empty `linked_*` columns get `link_type = NO LINKS`. The mapping is best-effort: the function detects hierarchy level by Jira issue type name (Initiative, Roadmap Item, Epic, Story/Task, Sub-task) and fills the corresponding `*_key/_title/_status` columns. Tune the JQL to scope what gets pulled.

Same-origin requests pass Basic Auth automatically (the browser caches it once the user signs in to the dashboard), so the endpoint is gated by the same `DASH_USER` / `DASH_PASSWORD` as the rest of the site.

## Live Pull via Glean Agent (optional)

The `Live Pull` tab embeds Avalara's Glean agent (`agentId: 4c8533e8373b41edbde22d6f5793d4d4`) via the official `embedded-search-latest.min.js` SDK. Viewers must be signed into Glean Avalara SSO for the embed to render — otherwise they'll see a Glean sign-in screen inside the panel. No additional env vars or secrets are required.

## Updating the password / user later

Vercel dashboard → Project → Settings → Environment Variables → edit `DASH_PASSWORD` → "Redeploy" the latest deployment for the change to take effect.

## Iterating on the app

Just push to `main`. Vercel auto-rebuilds and redeploys (this is the `vercel.json` `"github": { "silent": true }` setting; it'll re-deploy without spamming PR comments).

```bash
git add .
git commit -m "tweak: ..."
git push
```

## Safety notes

- The `.gitignore` excludes `node_modules`, `.tooling`, `dist`, `.vercel`, and any `.env*` files. Don't paste real Jira data into `SAMPLE_CSV` and commit it.
- If the password ever leaks, rotate `DASH_PASSWORD` in Vercel and redeploy.
- Basic Auth is fine for an internal leadership tool but transmits credentials in headers on every request — Vercel deployments are HTTPS-only, so this is safe in transit. Don't reuse the password elsewhere.

## If you want stronger auth later

- **Vercel SSO** (paid Pro plan, integrates with Okta/Avalara SSO) — replaces the Basic Auth middleware.
- **Cloudflare Access** — free up to 50 users, gates by email magic-link.
- **Move to internal hosting** — `npm run build` → upload `dist/` to an Avalara-internal static host (no auth code needed if hosted behind corp VPN/SSO).
