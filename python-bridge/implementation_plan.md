# Multi-Agent Sequential Upgrade & Optimization Plan (20-Agent Campaign)

This plan details a systematic, step-by-step upgrade, optimization, and stabilization campaign of the Wealth Dashboard application using all 20 specialist agents.

---

## User Review Required

> [!IMPORTANT]
> - **Unified Process Management**: We are introducing `ecosystem.config.js` (PM2) and `run_servers.bat` to manage the React and FastAPI servers as a single execution tree.
> - **SQLite Write Locking**: We will enforce thread-safe connection caching and increase the timeout to 15.0 seconds in `db.py` to prevent locks during heavy options data writes.
> - **Gamification System**: Using the `game-developer` agent, we will implement a lightweight trading simulation state machine in the Academy tab, utilizing IndexedDB for local mock trade history.

## Open Questions

> [!WARNING]
> 1. **Upstox Redirect URI**: The authentication token requires a daily login redirection. Do you have a specific port/domain registered with your Upstox App configuration? (Defaulting to `http://localhost:5173`).
> 2. **DevOps Target OS**: PM2 works on both Windows and Linux, but daemon/service management differs. Shall we focus the startup scripts primarily on Windows (.bat) or include Linux (.sh) configurations?

---

## Proposed Changes

### 📋 Phase 1: Product Definition & Mapping
* **Agents**: `product-manager`, `product-owner`, `explorer-agent`
* **Focus**: Establish feature requirements, map codebase dependencies, audit backlog items.
* **Target Files**:
  - `[MODIFY] [task.md](file:///C:/Users/gadda/.gemini/antigravity-ide/brain/6680768a-05c8-4c93-bdbd-05faa6015683/task.md)`: Build the complete task lists for all 20 agents.

---

### 🏛️ Phase 2: Database Schema & Write Safeguards
* **Agents**: `database-architect`, `security-auditor`, `penetration-tester`
* **Focus**: SQLite write safety, inputs sanitization, and CORS enforcement.
* **Target Files**:
  - `[MODIFY] [db.py](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/python-bridge/db.py)`: Increase connect timeout, add write transaction decorator with retry logic, optimize index on `upstox_cache`.
  - `[MODIFY] [app.py](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/python-bridge/app.py)`: Enforce strict Pydantic parsing, lock down origins.

---

### ⚙️ Phase 3: Core API Pipeline & Failure-Tolerance
* **Agents**: `backend-specialist`, `debugger`
* **Focus**: Expired token redirection, in-memory rate-limiter, error fallback payloads.
* **Target Files**:
  - `[MODIFY] [upstox.py](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/python-bridge/upstox.py)`: Introduce 401 re-auth redirection URL structure, implement sliding-window memory rate-limiter.
  - `[MODIFY] [app.py](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/python-bridge/app.py)`: Catch and forward structured 401 Auth errors.

---

### 🎨 Phase 4: Responsive UI Rhythm & Motion/Gamification
* **Agents**: `frontend-specialist`, `mobile-developer`, `game-developer`
* **Focus**: Mobile viewport fit, touch targets, trading simulation state machine.
* **Target Files**:
  - `[MODIFY] [Academy.tsx](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/components/tabs/Academy.tsx)`: Implement client-side gamified trading paper-log simulator.
  - `[MODIFY] [index.css](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/index.css)`: Refine mobile touch targets (44x44px minimum) and responsive display selectors.

---

### ⚡ Phase 5: Performance Optimization & SEO Metadata
* **Agents**: `performance-optimizer`, `seo-specialist`
* **Focus**: Memoization, list virtualization, preconnect meta tags, semantic HTML tags.
* **Target Files**:
  - `[MODIFY] [index.html](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/index.html)`: Add preconnect tags for external resources, optimize viewport scaling.
  - `[MODIFY] [StockScreenerWidget.tsx](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/components/alpha/StockScreenerWidget.tsx)`: Virtualize long table rendering rows.

---

### 🚀 Phase 6: DevOps, Auto-Restart & Health Auditing
* **Agents**: `devops-engineer`, `qa-automation-engineer`
* **Focus**: PM2 ecosystem configurations, database cleanup automation, E2E checks.
* **Target Files**:
  - `[NEW] [ecosystem.config.js](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/ecosystem.config.js)`: Define PM2 server declarations.
  - `[NEW] [run_servers.bat](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/run_servers.bat)`: Concurrent startup bat script.

---

### 🧪 Phase 7: Testing & Refactoring Legacy Code
* **Agents**: `test-engineer`, `code-archaeologist`
* **Focus**: python-bridge pytest/unittest suites, code formatting audits, unused code pruning.
* **Target Files**:
  - `[NEW] [test_db.py](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/python-bridge/tests/test_db.py)`: Database operations tests.
  - `[NEW] [test_upstox.py](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/python-bridge/tests/test_upstox.py)`: Upstox client caching and rate limiter tests.

---

### 📝 Phase 8: System Documentation & Coordination
* **Agents**: `documentation-writer`, `orchestrator`
* **Focus**: Write installation manuals, API docs, system maps, execute final checklists.
* **Target Files**:
  - `[MODIFY] [README.md](file:///c:/Users/gadda/Desktop/Projects/1. Wealth Dashboard v2/README.md)`: Document backend tests, PM2 execution commands, and rate-limiting behaviors.

---

## Verification Plan

### Automated Verification
* Run backend tests:
  ```bash
  python -m unittest discover -s python-bridge/tests
  ```
* Run master checklist:
  ```bash
  python .agent/scripts/checklist.py .
  ```
* Verify TypeScript builds:
  ```bash
  npm run build
  npx tsc --noEmit
  ```

### Manual Verification
* Start server via PM2 and check logs: `pm2 logs`.
* Verify that the Academy paper-log simulator stores and updates data inside local storage / IndexedDB.
