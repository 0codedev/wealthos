# 🧠 Volume 08: Trading Psychology Stack, Mirror of Truth & Quant Duel

> **Component of:** [WealthOS v2 Documentation Index](../README.md#-master-documentation-index)

---

## 15. Trading Journal & Mirror of Truth 2.0

### Trade Journal 2.0 (CC18, CC18B)

The trading journal is the most psychologically sophisticated component. **Trade Diary 2.0** adds a premium dashboard, P&L calendar, and metrics confluence.

| Feature | Description |
|---------|-------------|
| **Emotion Tagging** | Pre and post-trade emotion logging (Focused/Anxious/Bored/Revenge/Greedy) |
| **Trade Grading** | A+/A/B/C/D/F setup quality grades |
| **Mistake Taxonomy** | FOMO, Chasing, No Stop Loss, Overleveraged, Early Exit, Hesitation, Revenge Trade, News Trading |
| **Compliance Score** | 0-100 score based on checklist adherence |
| **Psychological P&L** | Computes cost of psychological mistakes (opportunity cost) |
| **Tilt Detection** | tiltScore, fomoLevel, stressLevel metrics |
| **Physical State** | Rested/Fatigued/Caffeinated/Hungover/Sick correlation |
| **AI Verdict** | Per-trade AI analysis: BUY/SELL/HOLD/WAIT with conviction score |
| **Screenshots** | Multi-screenshot capture with canvas annotations (HTF, Entry, Exit) |
| **Video (Loom)** | Loom URL attachment for trade review recordings |
| **P&L Calendar** | See every trade on a heatmap calendar |
| **Cosmic Circuit Breaker** | Automatic cool-down triggers when emotion + loss streak align |
| **Slump Buster** | Guided flow that helps you break out of losing streaks |
| **What-If Scenario Builder** | Replay history with different exits |
| **Bulk Action Tray** | Multi-select trades for batch operations |
| **Trade Auditor** | Pre-trade compliance check before any live order |
| **Voice Journal** | Log a trade with your voice, Whisper transcription |

### Mirror of Truth 2.0

The `Mistake` entity tracks costly financial lessons. **Mirror 2.0** auto-generates `MirrorRule` entries -- active trading rules derived from past errors, with weight-based priority and "expire after N days" semantics.

### Profitability Score (Phase 12)

A single 0–100 KPI computed from journal data, with 5 sub-scores:

1. **Discipline** (checklist adherence, pre-trade emotion log, stop-loss compliance)
2. **Edge** (win rate × avg win / avg loss)
3. **Risk** (position sizing, max drawdown, single-trade risk)
4. **Review** (post-trade notes, journal frequency)
5. **Recovery** (time-to-recovery after losses, cool-down adherence)

Tier: Beginner → Apprentice → Practitioner → Specialist → Master. Coach cue adapts to tier.

---

## 13. Psychology and Trading Journal Stack

### Trade Journal Features (29 Phases)

The trading journal is the most psychologically sophisticated component. Key features:

| Feature | Description |
|---------|-------------|
| **Emotion Tagging** | Pre and post-trade emotion logging (Focused/Anxious/Bored/Revenge/Greedy) |
| **Trade Grading** | A+/A/B/C/D/F setup quality grades |
| **Mistake Taxonomy** | FOMO, Chasing, No Stop Loss, Overleveraged, Early Exit, Hesitation, Revenge Trade, News Trading |
| **Compliance Score** | 0-100 score based on checklist adherence |
| **Psychological P&L** | Computes cost of psychological mistakes (opportunity cost) |
| **Tilt Detection** | tiltScore, fomoLevel, stressLevel metrics |
| **Physical State** | Rested/Fatigued/Caffeinated/Hungover/Sick correlation |
| **AI Verdict** | Per-trade AI analysis: BUY/SELL/HOLD/WAIT with conviction score |
| **Screenshots** | Multi-screenshot capture with canvas annotations (HTF, Entry, Exit) |
| **Video (Loom)** | Loom URL attachment for trade review recordings |

### Mirror of Truth

The `Mistake` entity tracks costly financial lessons:

```typescript
interface Mistake {
  id: string;
  date: string;
  title: string;
  cost: number;         // Financial cost in ₹
  category: 'TRADING' | 'LIFE';
  lesson: string;
  emotionalState?: string;
  tags?: string[];
  actionItems?: string[];
  relatedTopics?: string[];
}
```

Mistakes auto-generate `MirrorRule` entries -- active trading rules derived from past errors.

### Guardian Protocol State Machine

```
Normal Trading
  -> Loss > maxDailyLoss?
    -> HALT: Cooling Period Enforced
      -> Cooldown Timer Expired?
        -> RESUME (with required emotion log)

Order Attempt
  -> Position size > maxSingleTradeRisk?
    -> BLOCK: "Size violates risk rules"
  -> Checklist not completed?
    -> BLOCK: "Complete pre-trade checklist first"
  -> Recent loss streak > maxConsecutiveLosses?
    -> SOFT BLOCK: "You've had N consecutive losses. Confirm override."
```

### Quant Duel (Forward Dueling)

A daily paper trading challenge where the user competes against the algorithmic system:

```typescript
interface ForwardDuel {
  date: string;
  systemTicker: string;        // Algorithm's pick at 9:50 AM
  systemEntryPrice: number;
  systemPeakPrice: number;     // Tracked throughout session
  systemStatus: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'EOD_EXIT';
  systemPnL: number;

  userTicker: string;          // User's manual pick
  userEntryPrice: number;
  userPeakPrice: number;
  userStatus: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'EOD_EXIT';
  userPnL: number;
}
```

---

