# M&A Jira Hierarchy + Linked-Issue Dashboard

Local React + Vite app for the M&A RI dashboard.

## Run locally

Node.js + npm are not installed system-wide on this machine, so a portable Node is bootstrapped into `.tooling/`.

```bash
# from project root, every new terminal:
export PATH="$PWD/.tooling/node-v22.11.0-darwin-arm64/bin:$PATH"

# install (only first time)
npm install

# start dev server (http://localhost:5173)
npm run dev

# production build
npm run build && npm run preview
```

## Stack

- Vite + React 18 + TypeScript (the dashboard component itself is `.jsx`)
- Tailwind CSS v3
- shadcn/ui primitives (Card, Button, Input, Textarea, Badge, Select)
- recharts (charts)
- lucide-react (icons)

## Project structure

```
src/
  components/
    MnaRiLinkedIssueDashboard.jsx   # main dashboard
    ui/                              # shadcn primitives
  lib/utils.ts                       # cn() helper
  App.tsx
  main.tsx
  index.css                          # tailwind + design tokens
```
