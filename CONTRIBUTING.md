# Contributing to WealthOS v2

Thank you for your interest in contributing to **WealthOS v2**! We welcome bug reports, architectural improvements, and algorithmic enhancements from developers and quantitative researchers.

---

## 📜 Code of Conduct & Contribution Standards

1. **Local-First & Privacy Invariant:** Never introduce dependencies or logic that leaks user trades, credentials, or telemetry to third-party endpoints.
2. **Deterministic Architecture:** Maintain offline capability. Mock fallbacks must always succeed gracefully when internet or API keys are unavailable.
3. **Commit Integrity:** Follow Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`).
   - **Important:** Never add automated AI agents as co-authors on commits. Humans remain fully accountable for code quality.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Node.js:** v18+ (Node 20 LTS recommended)
- **Python:** 3.11+
- **Package Manager:** npm / pip

### 2. Fork & Clone
```bash
git clone https://github.com/<your-username>/wealthos.git
cd wealthos
```

### 3. Install Dependencies
```bash
# Frontend
npm install

# Python Bridge Backend
cd python-bridge
pip install -r requirements.txt
cd ..
```

### 4. Running the Development Stack
```bash
# Terminal 1: Frontend Client
npm run dev

# Terminal 2: Python Bridge Service
cd python-bridge
python app.py
```

---

## 🧪 Verification & Testing

Before submitting a Pull Request, ensure that:

```bash
# Run TypeScript compilation checks
npx tsc --noEmit

# Run Frontend Vitest tests
npm run test

# Run Python Bridge unit tests
cd python-bridge
python -m unittest discover -s tests -v
cd ..
```

---

## 🚀 Submitting a Pull Request

1. Create a feature branch: `git checkout -b feat/your-feature-name`
2. Commit your changes: `git commit -m "feat(quant): add Black-Scholes IV surface calculation"`
3. Push to your fork: `git push origin feat/your-feature-name`
4. Open a Pull Request targeting `main`. Describe your changes, test results, and any relevant issue references.
