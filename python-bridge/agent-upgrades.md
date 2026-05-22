# Agent-by-Agent Application Upgrade & Optimization Plan

## Overview
This plan outlines a comprehensive, sequential upgrade and optimization of the Wealth Dashboard application using specialist agents. We will audit and upgrade the app domain-by-domain to optimize performance, enhance security, verify schemas, and polish UI layouts.

## Project Type
WEB / BACKEND (FastAPI Python Bridge + Vite React Frontend)

## Success Criteria
- **Zero Errors**: Clear compilation (`npx tsc --noEmit`) and successful production build (`npm run build`).
- **Rapid Transitions**: Maintains the instant (0ms) tab switching and drill-down responses.
- **Robust Database**: SQLite `cache.db` query optimization and IndexedDB schema verification.
- **Top-Tier Security**: Environment variable safety and CORS lockdown.
- **Premium Aesthetics**: Custom CSS, glassmorphism components, and smooth hover micro-animations matching the design system.
- **SEO & Performance**: Optimized Lighthouse stats and perfect meta tags.

## Tech Stack
- **Frontend**: React (TypeScript), Tailwind CSS, Vite, Recharts, Dexie (IndexedDB)
- **Backend**: FastAPI (Python), Uvicorn, SQLite, Pandas, Upstox API, Yahoo Finance API

## File Structure
```plaintext
c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/
├── .agent/                  # Agents, skills, and validation scripts
├── python-bridge/           # FastAPI backend
│   ├── app.py               # Main API routes
│   ├── db.py                # SQLite database management
│   ├── upstox.py            # Upstox API client
│   └── cache.db             # Local caching database
├── database.ts              # IndexedDB browser database
├── App.tsx                  # Main entry view layout
└── index.css                # Custom styling system
```

## Task Breakdown

### Task 1: Database Optimization & Schema Review
- **Agent**: `database-architect`
- **Skills**: `database-design`
- **Priority**: P0
- **Dependencies**: None
- **INPUT**: `python-bridge/db.py` SQLite schemas and `database.ts` Dexie structures.
- **OUTPUT**: Optimized database indexing structures and query execution patterns.
- **VERIFY**: Run `python .agent/skills/database-design/scripts/schema_validator.py` to ensure schema integrity.

### Task 2: Secrets Scan & Route Parameter Lockdown
- **Agent**: `security-auditor`
- **Skills**: `vulnerability-scanner`
- **Priority**: P0
- **Dependencies**: Task 1
- **INPUT**: FastAPI routes in `python-bridge/app.py` and environment declarations.
- **OUTPUT**: Restricted CORS configurations, strict input type validation, and zero leaked keys.
- **VERIFY**: Run `python .agent/skills/vulnerability-scanner/scripts/security_scan.py .` for security sweeps.

### Task 3: REST Cache Tuning & Scheduler Optimization
- **Agent**: `backend-specialist`
- **Skills**: `api-patterns`, `python-patterns`
- **Priority**: P1
- **Dependencies**: Task 2
- **INPUT**: `python-bridge/app.py` and `upstox.py` clients.
- **OUTPUT**: Thread-safe background jobs and cached API responses to avoid rate limits.
- **VERIFY**: Start `start.bat` and run API endpoint fetch requests to check cache hits.

### Task 4: Layout Accents & Custom Scrollbars Refinement
- **Agent**: `frontend-specialist`
- **Skills**: `frontend-design`, `ui-ux-pro-max`
- **Priority**: P2
- **Dependencies**: Task 3
- **INPUT**: `index.css` global styles and layout components.
- **OUTPUT**: Modern CSS layouts, glassmorphism panels, and interactive micro-animations.
- **VERIFY**: Run `python .agent/skills/frontend-design/scripts/ux_audit.py .` to check compliance.

### Task 5: Component Rendering Optimization & Memoization
- **Agent**: `performance-optimizer`
- **Skills**: `performance-profiling`
- **Priority**: P3
- **Dependencies**: Task 4
- **INPUT**: Chart components (`StockScreenerWidget.tsx`, `MacroPulse.tsx`).
- **OUTPUT**: Wrapped component renders (`React.memo`) preventing re-render cascades.
- **VERIFY**: Switch tabs and check browser render cycles inside Chrome DevTools.

### Task 6: Document SEO Head & Social Tags
- **Agent**: `seo-specialist`
- **Skills**: `seo-fundamentals`
- **Priority**: P3
- **Dependencies**: Task 5
- **INPUT**: `index.html` main entry template.
- **OUTPUT**: Dynamic HTML dynamic heads, meta tags, and description fields.
- **VERIFY**: Run `python .agent/skills/seo-fundamentals/scripts/seo_checker.py .` to ensure tags are present.

---

## Phase X: Verification

### 1. Run Master Checklist
```bash
python .agent/scripts/checklist.py .
```

### 2. Verify Code Compilation
```bash
npm run build
npx tsc --noEmit
```

### 3. Check App Runtime
- Start the server using `python-bridge/start.bat`.
- Launch Vite dev server. Verify zero console errors and 0ms transitions.

### 4. Rule Compliance Check
- [ ] No standard generic template styles used.
- [ ] Socratic Gate was respected.
- [ ] Static imports and hybrid DOM-caching preserved.

## ✅ PHASE X COMPLETE
- Lint: [Pending]
- Security: [Pending]
- Build: [Pending]
- Date: [Pending]
