# Expansion Spec: Middle School Math & Language Arts (Theme-Driven Learning Games)

**Document type:** Product & curriculum specification (research-informed)  
**Status:** Draft for planning  
**Related product pattern:** Gene Code Explorer (hub + chapters + missions + checkpoint quiz + unified career XP + `localStorage` progress)

**Unified entry (all three games):** See **`nexus-meta-hub-prd-spec.md`** for the full **PRD + technical spec** of the **Nexus Academy** meta-hub—one interactive front door for Life Sciences (Gene Code), Mathematics (Orbital Academy), and ELA (Guild of the Lexicon), with umbrella narrative, engagement tactics, and cross-game progress.

---

## 1. Purpose

This spec spins off the **Gene Code Explorer** model—browser-based, mission/quiz XP, themed hub, chapter progression—into **two parallel subject tracks** for U.S. middle grades (approximately grades 6–8):

| Track | Working title | Theme | Core subject anchor |
|--------|----------------|-------|----------------------|
| **A** | *Orbital Academy* (working) | **Space / sci‑fi exploration** | **Middle School Mathematics** |
| **B** | *Guild of the Lexicon* (working) | **Fantasy / quest narrative** | **Middle School English Language Arts** |

**Goals:**

- Preserve what works: **clear progression**, **short missions**, **low-stakes retries**, **visible XP**, **kid-facing identity** (codename / call sign / hero name), **teacher- and parent-friendly alignment** to standards.
- Differentiate **tone and metaphor** per subject without fragmenting the **same core game loop** (so engineering and UX patterns can be reused).

---

## 2. Research basis (concise)

### 2.1 Standards alignment (United States, widely adopted frame)

**Mathematics (Grades 6–8)** — Common Core State Standards for Mathematics organizes middle school by **domain** across grades, including (non-exhaustive):

- **Ratios & Proportional Relationships** (e.g., unit rates, tables, graphs)
- **The Number System** (e.g., rational numbers, negatives, fractions/decimals)
- **Expressions & Equations** (e.g., variables, equivalent expressions, inequalities)
- **Geometry** (e.g., area, volume, transformations, Pythagorean theorem in grade 8)
- **Statistics & Probability** (e.g., distributions, samples, chance models)
- **Functions** (grade 8 emphasis: defining functions, linear vs nonlinear)

*Source structure:* [Common Core State Standards Initiative — Mathematics](https://www.thecorestandards.org/Math/)

**English Language Arts (Grades 6–8)** — CCSS ELA is organized by **strand**, including:

- **Reading: Literature (RL)** — theme, evidence, character, craft, compare texts
- **Reading: Informational Text (RI)** — central ideas, arguments, integration of media
- **Writing (W)** — argument, informative/explanatory, narrative; process and research
- **Language (L)** — conventions, grammar, vocabulary in context
- **Speaking & Listening (SL)** — collaboration, presentations (often underrepresented in solo browser games—see §7)

*Source structure:* [Common Core State Standards Initiative — ELA](https://www.thecorestandards.org/ELA-Literacy/)

**Note:** States and districts vary (e.g., TEKS, NGSS-adjacent integration). This spec assumes **CCSS as a default mapping layer** with room to export objectives to other frameworks.

### 2.2 Learning science (design constraints, not guarantees)

- **Worked examples + varied practice** support procedural skills (math); **authentic tasks** support transfer (both subjects).
- **Formative assessment** (frequent checks with feedback) generally supports middle-grade motivation when framed as **progress**, not punishment.
- **Cognitive load:** five missions + short quiz per chapter matches **chunked** practice; avoid reading-heavy UI in the math track and avoid symbol overload in the ELA track’s first missions of each chapter.

### 2.3 Game-based learning (pragmatic)

- **Intrinsic integration:** math tasks should feel like *navigation, calibration, fuel, trajectory* (space), not pasted worksheets with stars.
- **Narrative wrapper:** fantasy ELA can motivate **close reading** as *decoding runes*, **revision** as *forging*, **grammar** as *guild law*—but **assessed skills must remain identifiable** to teachers.

---

## 3. Inherited mechanics from Gene Code Explorer (baseline contract)

| Mechanic | Gene Code | Math / ELA adaptation |
|----------|-----------|-------------------------|
| Hub | Themed intro + optional 3D/visual hero | Space station / fantasy realm map |
| Chapters | 4 lessons × (5 missions + 4 quiz Qs) | **Configurable** (e.g., 4–6 units per grade band or per course) |
| XP | Missions + quiz questions → career bar | Same **economy**; rebalance points per subject if needed |
| Identity | Codename | **Math:** *Call sign* or *Commander name* · **ELA:** *Hero name* or *Guild name* |
| Persistence | `localStorage` | Same; future account sync is out of scope for v1 spec |
| Finale | All chapters complete | **Constellation mastery** (math) / **Epilogue** (ELA) |

**Spec decision:** Treat each subject as its own **“game shell”** (`math-game.js`, `ela-game.js`) sharing a **common progress schema** (`learningQuest_v1` or similar) with fields: `subject`, `gradeBand`, `units[]`, `name`, `mute`, `grandFinaleSeen`.

---

## 4. Track A — Middle School Mathematics — *Orbital Academy* (space theme)

### 4.1 Fantasy of the theme (player-facing)

Students are **trainees at an orbital academy** preparing for deep-space missions. Every math skill is framed as **ship systems**: navigation (coordinate grids), fuel & cargo (ratios), shields (inequalities), sensors (statistics), jump calculations (expressions), wormhole geometry (angles, distance).

**Tone:** hopeful, curious, competent—avoid military aggression; emphasize **exploration and safety**.

### 4.2 Chapter (unit) map — example 4-chapter *Grade 7* slice

*(Illustrative; final scope should follow district pacing guides.)*

| Chapter | Narrative frame | Math focus (CCSS domains / examples) |
|---------|-----------------|--------------------------------------|
| **1. Launch window** | Countdown, cargo ratios | **RP** unit rates; **NS** operations with rationals |
| **2. Transfer orbit** | Matching velocities, fuel burn | **RP** proportional relationships; **EE** linear relationships |
| **3. Sensor sweep** | Asteroid fields, debris scatter plots | **SP** sampling, variability; simple **probability** |
| **4. Deep space geometry** | Docking, angles, modules | **G** scale drawings, area/volume; intro **Pythagorean** if grade 8 slice |

**Mission archetypes (examples):**

1. **Calibration** — timed/accuracy tasks (fluency within reason; offer “practice mode”).
2. **Plot the course** — drag on coordinate plane or number line.
3. **Systems check** — error spotting (which step broke?).
4. **Away mission** — short word problem with scaffolded variables.
5. **Captain’s log** — one multi-step item requiring explanation (typed or multiple choice of explanations).

**Checkpoint quiz:** 4 items mixing **concept + one procedural** item; align distractors to common misconceptions (e.g., adding numerators only, cross-multiply errors).

### 4.3 Anti-patterns to avoid

- **Story that overwhelms the math** (keep story panels ≤ 30–45 seconds read).
- **“Guess the operation”** without number sense cues.
- **Timers** as the only difficulty—prefer **optional** speed rounds.

---

## 5. Track B — Middle School Language Arts — *Guild of the Lexicon* (fantasy theme)

### 5.1 Fantasy of the theme (player-facing)

Students are **initiates in a word-guild** where stories are **living realms**. Reading is **exploration**, evidence is **relics**, writing is **quests**, grammar is **the old laws**, and vocabulary is **artifacts** and **charms**.

**Tone:** inclusive fantasy—**avoid** clichéd “rescuing princess” defaults; emphasize **agency, craft, and collaboration** (guild).

### 5.2 Chapter (unit) map — example 4-chapter *Grades 6–8 blended* slice

| Chapter | Narrative frame | ELA focus (CCSS strands / examples) |
|---------|-----------------|--------------------------------------|
| **1. The map & the trail** | Entering the realm | **RL/RI.1** cite evidence; **RL/RI.2** theme/central idea |
| **2. Voices in the hall** | NPCs with conflicting accounts | **RL/RI.6** point of view; **RI.8** arguments & claims |
| **3. The forge of drafts** | Shaping a quest letter | **W.1** argument; **W.2** informative; **W.4–5** revision |
| **4. Sigils of precision** | Sealing the manuscript | **L.1–2** conventions; **L.4–6** word choice & nuance |

**Mission archetypes (examples):**

1. **Relic match** — drag evidence to claim (highlighting practice).
2. **Echo chamber** — identify tone or POV from short excerpts.
3. **Runewright** — sentence combining / punctuation as “seals.”
4. **Parley** — choose the strongest counterargument (argument writing).
5. **Chronicle** — order paragraphs or outline (structure).

**Checkpoint quiz:** short **authentic excerpts** (fair use length) + **technology-friendly** interactions (highlight, reorder, multiple select). Avoid long essays in v1 for **reliable auto-scoring**; use **rubric-aligned MC** or **constrained constructed response** (one sentence) with pattern hints.

### 5.3 Anti-patterns to avoid

- **Trivia-only** reading (theme ≠ “guess the author’s birthday”).
- **Grammar disconnected** from meaning—always tie **conventions** to **clarity of message**.
- **Cultural monoculture** in fantasy—use **diverse authors** in excerpts when licensing permits.

---

## 6. Shared product architecture (spec-level)

### 6.1 Information architecture

```
/{subject}/index.html          → hub (themed)
/{subject}/scores.html          → progress
/{subject}/unit-{n}-{slug}.html → chapter (or SPA later)
/assets/{subject}/game-core.js
```

### 6.2 Progress schema (draft)

```json
{
  "schemaVersion": 1,
  "subject": "math" | "ela",
  "themeId": "space" | "fantasy",
  "gradeBand": "6-8",
  "playerLabel": "callsign" | "heroName",
  "displayName": "string",
  "mute": false,
  "careerXP": 0,
  "grandFinaleSeen": false,
  "units": [
    {
      "id": "g7-ratios",
      "missions": [false, false, false, false, false],
      "quiz": [false, false, false, false]
    }
  ]
}
```

### 6.3 Content pipeline (for production)

1. **Learning objective** → **mission brief** + **item bank** (50+ items per chapter for variety).
2. **Copy review** for reading level (target **grades 6–8** band; Flesch-Kincaid as advisory only).
3. **Bias & sensitivity** pass (especially ELA excerpts).
4. **Accessibility:** keyboard, ARIA on interactive tasks, color-blind safe feedback (not red/green alone).

---

## 7. Speaking & listening (ELA) note

CCSS **SL** standards are hard to assess in a **solo static** web app. **Spec options:**

- **Phase 1:** Omit formal SL assessment; suggest **classroom extension** (“Record your guild report” as teacher-led).
- **Phase 2:** Optional **mic-off** script practice with **teacher-uploaded** rubric, or integration with LMS—**out of scope** for initial static deployment.

---

## 8. Phased roadmap (recommended)

| Phase | Deliverable | Exit criteria |
|-------|-------------|----------------|
| **P0 — Spec** | This document + stakeholder sign-off on themes & chapter count | Agreed grade scope (one grade vs 6–8 spiral) |
| **P1 — Vertical slice** | One full chapter per subject (5 missions + 4 quiz + hub teaser) | Usability test with 5–8 students; teacher review sheet |
| **P2 — Full course shell** | 4 chapters each, scores page, finale | Standards coverage map v1 complete |
| **P3 — Polish** | Item randomization, wrong-answer explanations, analytics hooks | Lighthouse a11y pass on primary flows |

---

## 9. Success metrics (draft)

- **Engagement:** median session length, chapter completion rate.
- **Learning (proxy):** pre/post short probe (teacher-administered) aligned to chapter objectives—not solely in-game XP.
- **Qualitative:** student interest surveys (“I want to play another chapter”).

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Theme feels childish for grade 8 | Offer **“cadet / officer / archivist”** tone sliders in copy; minimal cartooning |
| Math anxiety | **Normalize mistakes**; streak without harsh failure |
| ELA licensing | Use **original micro-fiction** + **public domain** excerpts first |
| Scope creep | Lock **one grade band** for MVP |

---

## 11. Open questions (for product / curriculum workshop)

1. **Scope:** One grade (e.g., 7) vs full 6–8 in v1?
2. **Assessment philosophy:** SAT-style rigor vs classroom formative—where should quiz items sit?
3. **Teacher dashboard:** In scope for v2?
4. **Bilingual / ESL:** Spanish UI or glossaries in a later phase?

---

## 12. References (starting points)

- Common Core State Standards Initiative — Mathematics: https://www.thecorestandards.org/Math/
- Common Core State Standards Initiative — English Language Arts: https://www.thecorestandards.org/ELA-Literacy/
- Gene Code Explorer pattern (local implementation): hub + chapter XP economy + `geneCodeExplorer_v2` persistence

---

*End of spec draft.*
