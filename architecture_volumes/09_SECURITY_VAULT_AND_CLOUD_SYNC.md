# 🔐 Volume 09: AES-256 Vault, Dual Auth & Cloud Sync Architecture

> **Component of:** [WealthOS v2 Documentation Index](../README.md#-master-documentation-index)

---

## 16. Security, Privacy & AES-256 Vault

### Local-First Privacy Model

**No financial data ever leaves your machine** unless you explicitly enable Firebase sync. The default data flow is:

```
Your Data -> IndexedDB (browser)
           -> Zustand (memory)
           -> SQLite in python-bridge/ (if bridge running)

NOT -> Any cloud service
NOT -> Any analytics/telemetry
NOT -> Any third-party data broker
```

### AES-256 Encryption

The `SecurityService` and `Encryption.ts` implement client-side encryption for sensitive fields:

```typescript
// Key derivation: PBKDF2 with 100,000 iterations
// Algorithm: AES-256-CBC (crypto-js)
// Key source: User PIN hash + device fingerprint salt

class SecureApiKeyStorage {
  get<T>(): T | null     // Decrypt from localStorage
  set(value: T): void    // Encrypt before localStorage write
  clear(): void          // Secure wipe
}
```

### Guardian Protocol (Trading Guardrails)

The `useGuardrailStore` implements behavioral guardrails to protect against impulsive trading:

```typescript
interface GuardrailConfig {
  maxDailyLoss: number;          // Auto-halt if daily P&L < threshold
  maxSingleTradeRisk: number;    // Block orders > X% of portfolio
  requireChecklistBefore: boolean; // Enforce pre-trade checklist
  requireEmotionLog: boolean;    // Block entry without mood logging
  cooldownAfterLoss: number;     // Mandatory minutes after stop-out
  maxConsecutiveLosses: number;  // Halt after N consecutive losses
}
```

### API Security in Python Bridge

```python
# Rate Limiting: 180 req/min per IP (thread-safe sliding window)
# Security Headers on all responses:
response.headers["X-Frame-Options"] = "DENY"
response.headers["X-Content-Type-Options"] = "nosniff"
response.headers["X-XSS-Protection"] = "1; mode=block"
response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

# CORS: Restricted to localhost:3000 and :5173 only
# No public internet exposure intended
```

---

## 12. Cloud Sync, Firebase & Supabase

### Firebase Setup

The app uses Firebase for optional cloud backup and multi-device sync:

| Service | Usage |
|---------|-------|
| **Firebase Auth** | Google OAuth2 + email/password login |
| **Firestore** | Encrypted portfolio/settings sync |
| **Firebase Storage** | Trade screenshot uploads (optional) |

### Dual Auth System

The app supports **two independent auth layers**:

```
Layer 1: Local PIN Auth (AuthContext.tsx)
  -> PIN-based access gate (no internet required)
  -> PIN stored as PBKDF2 hash in localStorage
  -> Offline capable

Layer 2: Firebase Auth (FirebaseAuthContext.tsx)
  -> Google or Email/Password login
  -> Required for cross-device sync only
  -> Can be skipped entirely for local-only use
```

### Sync Architecture

```typescript
// FirebaseSyncService.ts
// Sync direction: Local IndexedDB <- Firestore <- Other devices

// Conflict resolution: Latest timestamp wins
// Data encrypted with user's PIN before Firestore upload
// Sync records table tracks per-entity sync state:
syncStatus: 'SYNCED' | 'PENDING' | 'STALE' | 'CONFLICT' | 'ERROR'
```

---

