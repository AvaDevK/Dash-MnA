# dashboard-mna

Local React + Vite app for the M&A Jira Hierarchy + Linked-Issue Dashboard.

## Stack
- React + Vite
- TypeScript (middleware.ts)
- Tailwind CSS (postcss.config.js)
- Node.js / npm

## Run locally
```bash
npm install
npm run dev
```

## Build & Deploy
```bash
npm run build   # outputs to dist/
# See DEPLOY.md for deployment instructions
```

## Structure
- `api/` — backend API layer
- `dist/` — built output (do not edit manually)
- `index.html` — app entry point
- `middleware.ts` — request middleware
- `postcss.config.js` — Tailwind/PostCSS config

## Notes
- M&A = Mergers & Acquisitions; this dashboard tracks Jira issues across linked M&A projects
- `dist/` is committed for static hosting — run `npm run build` before pushing changes
