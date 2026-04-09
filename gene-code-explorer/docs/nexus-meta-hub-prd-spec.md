# Nexus Meta-Hub — Product Requirements Document (PRD) & Technical Specification

**Product codename:** Nexus Academy (meta-layer)  
**Document type:** PRD + SPEC (single file; Part A = product, Part B = technical)  
**Status:** Draft  
**Depends on:** Gene Code Explorer (live), Orbital Academy (math, planned), Guild of the Lexicon (ELA, planned)  
**Companion doc:** `expansion-middle-school-math-ela-spec.md`

---

# Part A — Product Requirements Document (PRD)

## A.1 Executive summary

**Nexus Academy** is the **single front door** to three themed learning games—**Life Sciences (Gene Code Explorer)**, **Mathematics (Orbital Academy)**, and **English Language Arts (Guild of the Lexicon)**—unified by one **over‑arching story**: the student is a **Nexus Cadet** training across **three realms of knowledge** (life, logic, language) to become a well‑rounded explorer.

The **Nexus Meta-Hub** (`nexus.html` or site root after product decision) is an **interactive, enticing landing experience** that uses **middle‑school‑appropriate engagement patterns** (autonomy, visible progress, identity, micro‑delight, low friction) to route players into the right game while celebrating **cross‑game progress** at a glance.

---

## A.2 Problem statement

- **Fragmentation:** Three standalone games risk feeling like three unrelated homework sites unless a **coherent meta‑layer** exists.
- **Discovery:** Students and teachers need **one bookmark** and **one mental model** (“my academy”) rather than three URLs.
- **Motivation:** Middle school learners respond to **clear goals**, **choice**, **feedback**, and **light narrative**; a static list of links underuses engagement potential.

## A.3 Goals

| ID | Goal | Measurable indicator |
|----|------|----------------------|
| G1 | One **umbrella theme** makes the three games feel like **one academy** | Qualitative: “same world” rating on student survey ≥ target |
| G2 | Hub is **interactive** (not a plain index) | ≥3 distinct interactive affordances (hover, animation, CTA, optional canvas) |
| G3 | **Cross‑game progress** visible without opening each game | Nexus summary shows XP or completion per track |
| G4 | **Fast path** to “continue learning” | ≤2 clicks from hub to active lesson in any game |
| G5 | **Accessible** on school Chromebooks and phones | WCAG 2.1 AA intent on hub primary flow |

## A.4 Non-goals (v1)

- **Single sign-on** or district roster sync (future).
- **Real-time multiplayer** or chat.
- **Replacing** individual game hubs—each game may keep its own chapter hub; Nexus is the **meta** entry.
- **Unified curriculum sequencing** across subjects (e.g., forced order Life → Math → ELA) unless district requests it later.

---

## A.5 Umbrella narrative (canon)

**Setting:** The **Nexus** is a training institute that exists “between” disciplines. Nature, numbers, and words are three **gateways** to understanding the universe.

- **Life Sciences — *Gene Code Explorer*:** The **Bio‑Vector** — decoding the hidden language of living things (DNA, heredity, cells, evolution).
- **Mathematics — *Orbital Academy*:** The **Astro‑Vector** — navigation, measurement, and pattern under the stars (ratios, equations, geometry, data).
- **Language Arts — *Guild of the Lexicon*:** The **Chronicle‑Vector** — stories, arguments, and precision with words (reading, writing, language).

**Player role:** **Nexus Cadet** (display name synced or suggested across games). Completing missions in any realm earns **Nexus Merit** (aggregate XP), advancing **Cadet Rank** (cosmetic tiers).

**Tone:** Inclusive, curious, competent—**not** militaristic; emphasize **exploration and craft**.

---

## A.6 Target users & personas

| Persona | Needs | Hub must… |
|---------|--------|-----------|
| **Morgan, 12** | Short attention, wants **choice**, hates boring menus | Feel like a **game lobby**; big visuals; “Continue”; **no wall of text** |
| **Jordan, 14** | Cares about **identity** and **stats** | Show **name + rank + per‑game bars**; optional badges |
| **Ms. Ruiz (teacher)** | Assign one link; see engagement at high level | Clear **three tracks**; future: simple teacher page (out of scope v1) |
| **Parent** | Safe, educational, no account hassle | Privacy statement; **local-only** progress explanation |

---

## A.7 Middle school engagement tactics (design basis)

These patterns are widely used in consumer and edtech UX for **early adolescence** (roughly 11–14). The hub should **intentionally** incorporate several—not as manipulation, but to meet learners where they are.

| Tactic | Application on Nexus Meta-Hub |
|--------|-------------------------------|
| **Autonomy / choice** | Three large **realm portals**; no forced order; “Where to today?” |
| **Competence / mastery** | Visible **progress rings or bars** per game + **Nexus Merit** total |
| **Relatedness (light)** | Shared **Cadet name** and **rank**; optional future “class code” |
| **Immediate feedback** | Hover/press states, animated transitions on portal selection |
| **Goals & clarity** | One-line **realm promise** per card; “Continue [Game]” when save exists |
| **Near wins** | Show **almost complete** chapters (e.g., 3/4 units started) when data allows |
| **Novelty & delight** | Subtle **motion** (CSS or canvas), **ambient** optional audio (muted by default) |
| **Low cognitive load** | **3 choices** primary; secondary links (scores, about) tucked clearly |
| **Mobile-first** | Thumb-friendly targets; portals stack on narrow screens |
| **Short sessions** | Copy encourages **one chapter at a time**; Continue lowers restart cost |

*Pedagogical note:* Engagement tactics support **time on task** only when paired with **quality items** inside each game (see subject specs).

---

## A.8 User stories (v1)

1. **As a cadet**, I want to **see all three games** in one cool screen so I feel like I’m in **one academy**, not three websites.
2. **As a cadet**, I want to **tap the game I’m in the mood for** so I have **choice** without hunting URLs.
3. **As a cadet**, I want to **see how far I’ve gotten** in each game **before** I open them so I feel **accomplished**.
4. **As a cadet**, I want a **Continue** button when I’ve played before so I **resume faster**.
5. **As a cadet**, I want the page to **work on my phone** so I can use it on the bus or at home.
6. **As a teacher**, I want a **single link** to share that branches to subjects so **orientation** is easy.

---

## A.9 Functional requirements — Meta-Hub

| ID | Requirement | Priority |
|----|-------------|----------|
| H1 | Display **three interactive portals** (Life Sciences, Math, ELA) with **distinct art direction** aligned to existing/planned themes | P0 |
| H2 | Each portal links to the **canonical entry** for that game (e.g., `hub.html` for Gene Code ecosystem or agreed path) | P0 |
| H3 | Show **per-game progress summary** (at minimum: **career XP** or **% complete** when schema supports it) | P0 |
| H4 | Show **aggregate Nexus Merit** (sum or weighted sum of three career XPs—see Part B) | P1 |
| H5 | **Continue learning** CTA: deep-link to **last played game**’s hub or most advanced incomplete chapter when detectable | P1 |
| H6 | **Unified Cadet name**: read/write a **shared display name** in a Nexus manifest; optional sync into each game on next visit (see Part B) | P1 |
| H7 | **Mute / reduce motion**: respect `prefers-reduced-motion` and a **sound off** default | P0 |
| H8 | **Scores / progress** page reachable from Nexus that can evolve into **cross-game dashboard** | P1 |
| H9 | **Student-facing copy**: keep it game-forward (XP, ranks, portals)—no login/account setup in v1; optional teacher-facing note on data staying on the device if needed | P0 |

---

## A.10 Non-functional requirements

- **Performance:** LCP &lt; 2.5s on mid-tier mobile over broadband (hub assets budget &lt; 500KB critical path without 3D).
- **Accessibility:** Keyboard navigation between portals; focus visible; contrast ≥ 4.5:1 for body text.
- **Internationalization:** English v1; string externalization recommended in implementation.
- **Privacy:** No PII sent to servers in v1; localStorage only.

---

## A.11 Success metrics (hub-specific)

- **Click-through:** % of sessions that enter ≥1 game within 30s of load.
- **Return rate:** repeat visits within 7 days (if telemetry added later).
- **Continue usage:** % of returning users using Continue vs manual portal (if implemented).
- **Qualitative:** SUS or kid-friendly 3-question survey on “fun” and “clear.”

---

## A.12 Release phasing

| Phase | Scope |
|-------|--------|
| **Nexus v0** | Static hub with three portals + copy + aggregate XP read from **Gene Code only**; placeholders for Math/ELA “Coming soon” with grayed stats |
| **Nexus v1** | Full read of three `localStorage` schemas + unified name + Continue |
| **Nexus v2** | Optional ambient WebGL background; teacher link; analytics |

---

# Part B — Technical Specification

## B.1 Information architecture

**Recommended URLs (static hosting friendly):**

```
/nexus.html                 ← Meta-Hub (primary front door; or rename root index per deploy)
/gene-code/hub.html         ← Gene Code chapter picker (existing)
/gene-code/...              ← lessons (existing)
/math/...                   ← Orbital Academy (future)
/ela/...                    ← Guild of the Lexicon (future)
/nexus-scores.html          ← Cross-game dashboard (or extend scores.html)
```

**Decision point:** If **GitHub Pages** has a single `index.html`, product can set **`index.html` → redirect to `nexus.html`** or make **`nexus.html` the index** content. Document the deploy choice in README.

---

## B.2 Umbrella visual system

| Realm | Codename | Primary accent | Metaphor |
|-------|----------|----------------|----------|
| Life Sciences | Gene Code Explorer | Teal / bio-luminescent | Helix, cells |
| Mathematics | Orbital Academy | Deep blue / violet | Stars, orbit paths |
| Language Arts | Guild of the Lexicon | Amber / parchment gold | Runes, guild seal |

**Nexus chrome:** Dark neutral background (`#050809` family), **shared “Cadet” header** (Nexus logo + merit + name), **three portal cards** with realm gradients and **iconography** (helix, rocket/quasar, quill/seal).

---

## B.3 Hub page layout (spec)

1. **Hero band**  
   - Title: **Nexus Academy**  
   - Sub: **Train across three realms — life, logic, and language.**  
   - Optional: subtle **animated gradient** or **lightweight canvas** (particles / parallax stars) — **must** respect reduced motion.

2. **Cadet strip** (persistent)  
   - Display name (editable → writes Nexus manifest)  
   - Nexus Merit total  
   - Link: **Cross-realm report** (`nexus-scores.html`)

3. **Three portal cards** (primary interactive region)  
   - Large hit area; **hover / focus** lift + glow  
   - Inner: realm title, one-line hook, **mini progress bar** (XP fraction)  
   - Primary CTA: **Enter**  
   - Secondary: **Scores** (deep link to that game’s scores if exists)

4. **Continue row** (conditional)  
   - If `lastPlayedGame` present: **Continue [Realm name]** → URL from manifest

5. **Footer**  
   - Privacy / local storage; version; optional OSS credits for Three.js if used

---

## B.4 Interactive behaviors (detailed)

| Element | Behavior | Fallback |
|---------|----------|----------|
| Portal card | `transform` + `box-shadow` on hover/focus; `Enter` on Enter key | No-JS: plain links still work |
| Progress mini-bar | Width from % = `careerXP / maxCareer` per game | Show “Not started” if null |
| Cadet name | Inline edit modal or link to settings panel; writes `nexusAcademy_v1` | Read-only if edit deferred |
| Ambient animation | CSS `@keyframes` or requestAnimationFrame particles | Static background if `prefers-reduced-motion: reduce` |
| Sound | Optional **UI tick** on portal hover (if unmuted) | Off by default |

---

## B.5 Data model — Nexus manifest (cross-game)

New key: **`nexusAcademy_v1`** (name tentative; version in JSON).

```json
{
  "schemaVersion": 1,
  "displayName": "Explorer",
  "muteUiSounds": true,
  "lastPlayed": {
    "gameId": "geneCode",
    "href": "gene-code/hub.html",
    "updatedAt": "2026-04-09T12:00:00.000Z"
  },
  "nexusMerit": {
    "total": 0,
    "byGame": {
      "geneCode": 0,
      "orbitalMath": 0,
      "lexiconEla": 0
    },
    "maxPerGame": {
      "geneCode": 2400,
      "orbitalMath": 2400,
      "lexiconEla": 2400
    }
  }
}
```

**Aggregation rule (v1):**  
`nexusMerit.byGame.geneCode` = `GeneCodeGame.computeGlobalXP()` reading `geneCodeExplorer_v2`.  
When Math/ELA ship, mirror their `careerXP` into the same structure (on hub load, **read-only merge** from each game’s storage key).

**Cadet name sync:** On hub save, optionally `localStorage` patch into:
- `geneCodeExplorer_v2.name` (if exists)

Games already using `GeneCodeGame.setName` remain source of truth per session; Nexus is **convenience layer**.

---

## B.6 Integration points (per game)

| Game | Storage key (current / planned) | Hub reads |
|------|----------------------------------|-----------|
| Gene Code Explorer | `geneCodeExplorer_v2` | `computeGlobalXP`, optional per-lesson for detail view |
| Orbital Academy | `orbitalAcademy_v1` (planned) | `careerXP`, `units[]` completion |
| Guild of the Lexicon | `lexiconGuild_v1` (planned) | same pattern |

**Missing game:** Portal shows **“Launch when ready”** or **Coming soon** with **disabled** progress bar—never broken layout.

---

## B.7 Routing & deep links

- `nexus.html#gene-code` — scroll/focus Gene Code portal (optional).
- Continue CTA uses **`lastPlayed.href`**; must be validated against allowlist prefix to avoid `javascript:` injection if ever dynamic.

---

## B.8 Accessibility

- Portals: `<a>` or `<button>` wrapping navigable region with **visible focus ring**.
- Reduced motion: disable parallax and non-essential CSS transitions.
- Screen reader: each portal `aria-label` includes realm + progress summary.

---

## B.9 Performance budget

- First paint: system fonts + critical CSS inline optional.
- Defer Three.js or heavy canvas to **below the fold** or **omit on mobile** if FPS &lt; 30 on test devices.
- Lazy-load decorative scripts `type="module"`.

---

## B.10 Security & privacy

- No third-party trackers in v1 without DPA.
- **Content Security Policy** friendly: no inline scripts if policy requires nonces later.

---

## B.11 Testing checklist (acceptance)

- [ ] Three portals navigate correctly.
- [ ] Gene Code XP displays when save exists.
- [ ] New user sees zeros / empty states without errors.
- [ ] Keyboard-only navigation order logical.
- [ ] Reduced motion removes excessive animation.
- [ ] Works at 320px width.

---

## B.12 Open engineering questions

1. **Single repo vs monorepo** for three games—Nexus hub should live at **repo root** or `/docs` site root for simplest Pages deploy.
2. **Canonical URL** for Gene Code: keep `hub.html` vs rename under `/gene-code/`.
3. **Aggregate XP cap:** 7200 sum vs normalized rank—product decision.

---

# Appendix — Copy deck (draft strings)

| Location | Copy |
|----------|------|
| Meta title | Nexus Academy — Train in Life, Logic & Language |
| Hero | Three realms. One academy. Your progress, your pace. |
| Bio portal | Decode life’s hidden language — DNA to evolution. |
| Math portal | Navigate numbers among the stars — ratios to geometry. |
| ELA portal | Forge arguments and stories — evidence to precision. |

---

*End of Nexus Meta-Hub PRD & SPEC.*
