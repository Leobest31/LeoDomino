# LeoDomino — Premium UI Design Plan

**Scope:** Presentation only. Game engine, rules, and AI behavior are unchanged.  
**Reference:** Quality bar only (AAA mobile board-game feel). Original LeoDomino look — not a clone.

---

## 1. Visual identity

| Pillar | Direction |
|--------|-----------|
| Theme | Dark luxury — ebony room, warm brass/gold metal, deep emerald felt |
| Brand | Centered **LeoDomino** gold wordmark (serif), subtle metal sheen |
| Table | Multi-layer walnut frame + felt with fiber grain, vignette lighting |
| Tiles | Ivory bone, soft bevel, contact shadow, crisp pips |
| HUD | Compact status bar + elegant score plate + action dock |
| Motion | Existing flight/FLIP kept; add deal cascade, score tick, button press |

**Avoid:** purple neon, flat “web dashboard,” cream/terracotta brochure look, cluttered cards in the hero.

---

## 2. Screen architecture (same flow, elevated chrome)

```
┌──────────── Status / Brand bar (logo center) ────────────┐
│  [avatar You]     ◆ LeoDomino ◆      [⚙ Settings]       │
├──────────────────────────────────────────────────────────┤
│  Opponent panel (avatar + status + face-down hand)       │
│  ┌────┐  ┌────────── Felt table (wood frame) ──┐ ┌─────┐ │
│  │Res.│  │         tile chain                  │ │Score│ │
│  └────┘  └─────────────────────────────────────┘ └─────┘ │
│  Player panel (avatar + turn pulse + hand)               │
├──────────────────────────────────────────────────────────┤
│  Action dock: Play · Draw · Pass · New Match             │
└──────────────────────────────────────────────────────────┘
```

Home keeps brand-first hero; richer felt/wood atmosphere and gold CTA.

---

## 3. Component polish map

| Area | Change |
|------|--------|
| Tokens | Deeper blacks, brass scale, felt layers, lighting vars |
| Header → StatusBar | Centered gold logo; settings opens panel; difficulty/lang move into Settings |
| SettingsPanel | Slide-over: language, difficulty, close — i18n only |
| Avatar | CSS medallion (initials) for You / Rival |
| GameTable | Thicker wood molding, felt noise, corner lights |
| Domino | Richer bevel/shadow; keep pip logic |
| ScoreBoard | Brass plate, animated score values |
| Reserve | Wood niche + labeled stack |
| Player/Opponent | Avatar row, glass-edge panels |
| BottomBar | Premium engraved buttons + press states |
| Icons | Small SVG set (settings, home, play, etc.) |
| Home | Stronger brand gold + table atmosphere |

---

## 4. Motion (presentation only)

- Keep Phase 6 flights / FLIP / reduced-motion  
- Deal: staggered hand entrance on round change  
- Score: brief scale/fade when value changes  
- Buttons: hover (desktop), active press, disabled mute  
- Turn: existing pulse refined  
- AI thinking: existing status animation refined  

---

## 5. Responsive

- Phone: stacked HUD, score under/over table, full-width dock  
- Tablet/desktop: side reserve + score, wider felt  
- Fluid `clamp` / token sizes — no fixed px that clip hands  

---

## 6. Out of scope

- Rule changes, engine edits, AI strength changes  
- Online / accounts / tournaments  
- New game modes  

---

## 7. Success criteria

- Instant “premium table” read on first paint  
- Readable hierarchy: brand → table → hands → actions  
- 60 FPS transforms; `prefers-reduced-motion` honored  
- All i18n + engine/AI tests still pass  
