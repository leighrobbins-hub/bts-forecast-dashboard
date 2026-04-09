#!/usr/bin/env python3
"""Generate math/ela unit HTML from data tables. Run from dashboard/: python3 scripts/generate-realm-units.py"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MATH_CSS = """    :root {
      --bg: #050810;
      --bg-elevated: #0a1220;
      --text: #e8eaed;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-dim: #7dd3fc;
      --gold: #fbbf24;
      --a: #4ade80;
      --t: #fb7185;
      --radius: 12px;
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --hud-h: 100px;
    }"""

ELA_CSS = """    :root {
      --bg: #0c0a08;
      --bg-elevated: #17120e;
      --text: #f5f0e8;
      --text-muted: #a8a29e;
      --accent: #f59e0b;
      --accent-dim: #fcd34d;
      --gold: #fde68a;
      --a: #4ade80;
      --t: #fb7185;
      --radius: 12px;
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --hud-h: 100px;
    }"""

# gradient in body::before - math = cyan, ela = amber
MATH_BG = "radial-gradient(ellipse 70% 40% at 50% -10%, rgba(56, 189, 248, 0.1), transparent), radial-gradient(circle at 15% 80%, rgba(34, 211, 238, 0.05), transparent)"
ELA_BG = "radial-gradient(ellipse 70% 40% at 50% -10%, rgba(245, 158, 11, 0.12), transparent), radial-gradient(circle at 85% 70%, rgba(180, 83, 9, 0.08), transparent)"

# challenge border gradient
MATH_CH = "rgba(56, 189, 248, 0.25)"
ELA_CH = "rgba(245, 158, 11, 0.28)"


def esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def mission_block(mi: int, title: str, intro: str, prompt: str, choices: list[tuple[str, bool]]) -> str:
    lines = [
        f'      <div class="gce-challenge reveal" data-mi="{mi}">',
        '        <div class="gce-head">⚡ Checkpoint <span class="xp-pill">+100 XP</span></div>',
        f'        <p class="gce-prompt">{prompt}</p>',
        '        <div class="choice-grid cols-2">',
    ]
    for text, ok in choices:
        lines.append(
            f'          <button type="button" class="choice-btn" data-correct="{"true" if ok else "false"}">{text}</button>'
        )
    lines += [
        '        </div>',
        '        <div class="gce-feedback" aria-live="polite"></div>',
        "      </div>",
    ]
    sec = f"""    <section data-mission="{mi + 1}">
      <span class="mission-tag" data-mission-tag="{mi + 1}">Mission {mi + 1} · {esc(title)}</span>
      <p class="kicker reveal">Briefing</p>
      <h2 class="reveal d1">{esc(title)}</h2>
      <p class="intro reveal d2">{intro}</p>
{chr(10).join(lines)}
    </section>"""
    return sec


def quiz_box(qi: int, data_ok: int, prompt: str, opts: list[str], explain: str, delay: str = "") -> str:
    buttons = []
    for i, o in enumerate(opts):
        buttons.append(f'          <button type="button" data-i="{i}">{esc(o)}</button>')
    return f"""      <div class="quiz-box gce-quiz-box reveal{delay}" data-qi="{qi}" data-ok="{data_ok}">
        <p>{qi + 1}. {esc(prompt)}</p>
        <div class="quiz-opts cols-2">
{chr(10).join(buttons)}
        </div>
        <div class="explain"><p>{esc(explain)}</p></div>
      </div>"""


def page(
    *,
    realm: str,
    filename: str,
    title_full: str,
    h1: str,
    lead: str,
    lesson_id: str,
    op_label: str,
    storage_key: str,
    default_name: str,
    modal_welcome: str,
    modal_body: str,
    placeholder: str,
    home_href: str,
    home_label: str,
    hero_greeting: str,
    chapter_msg: str,
    grand_msg: str,
    chapter_badges: str,
    grand_badges: str,
    mission_ok: str,
    missions: list[dict],
    quizzes: list[dict],
    flashcards: list[tuple[str, str]],
    footer: str,
    api: str,
    confetti: str,
) -> str:
    is_math = realm == "math"
    css_root = MATH_CSS if is_math else ELA_CSS
    bg = MATH_BG if is_math else ELA_BG
    ch_border = MATH_CH if is_math else ELA_CH
    accent_rgba_08 = "56, 189, 248" if is_math else "245, 158, 11"
    accent_hex = "#38bdf8" if is_math else "#f59e0b"
    hud_border = f"rgba({accent_rgba_08}, 0.2)"

    mission_sections = []
    for i, m in enumerate(missions):
        mission_sections.append(
            mission_block(
                i,
                m["title"],
                m["intro"],
                m["prompt"],
                m["choices"],
            )
        )

    quiz_html = "\n".join(
        quiz_box(
            q["qi"],
            q["ok"],
            q["prompt"],
            q["opts"],
            q["explain"],
            q.get("delay", ""),
        )
        for q in quizzes
    )

    flash_html = ""
    for j, (q, a) in enumerate(flashcards):
        d = f' d{j}' if j else ""
        flash_html += f"""      <div class="flashcard reveal{d}"><p class="flashcard-q" tabindex="0" role="button">{esc(q)}</p><div class="flashcard-a"><div class="flashcard-a-inner">{a}</div></div></div>\n"""

    script_record = 'if (window.NexusAcademy) NexusAcademy.recordLastPlayed("' + (
        "orbital" if is_math else "lexicon"
    ) + '", location.href);'

    game_js = "orbital-game.js" if is_math else "lexicon-game.js"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc(title_full)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet" />
  <style>
{css_root}
    *, *::before, *::after {{ box-sizing: border-box; }}
    html {{ scroll-behavior: smooth; }}
    body {{
      margin: 0;
      padding-top: var(--hud-h);
      font-family: "DM Sans", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
      font-size: clamp(1rem, 0.95rem + 0.3vw, 1.1rem);
    }}
    body::before {{
      content: "";
      position: fixed;
      inset: 0;
      background: {bg};
      z-index: -1;
      pointer-events: none;
    }}
    .wrap {{ width: min(48rem, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 3rem; }}
    .sr-only {{ position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }}

    .game-hud {{
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.55rem 1rem;
      min-height: var(--hud-h);
      background: rgba(5, 8, 9, 0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid {hud_border};
      flex-wrap: wrap;
    }}
    .hud-brand {{ display: flex; flex-direction: column; gap: 0.1rem; font-weight: 700; font-size: 0.85rem; color: var(--accent); }}
    .hud-codename {{ font-size: 0.65rem; font-weight: 600; color: var(--text-muted); max-width: 14rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
    .hud-home-link {{ font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-decoration: none; }}
    .hud-home-link:hover {{ color: var(--accent); }}
    .hud-xp-stack {{ flex: 1; min-width: 160px; max-width: 280px; display: flex; flex-direction: column; gap: 0.35rem; }}
    .hud-xp {{ width: 100%; }}
    .hud-xp-label {{ display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.2rem; }}
    .hud-xp-bar {{ height: 7px; border-radius: 99px; background: rgba(255,255,255,0.08); overflow: hidden; }}
    .hud-xp-fill {{ height: 100%; width: 0%; border-radius: 99px; background: linear-gradient(90deg, {accent_hex}, var(--accent-dim)); transition: width 0.5s var(--ease-out); }}
    .hud-xp.global .hud-xp-fill {{ background: linear-gradient(90deg, #fbbf24, #f59e0b); }}
    .hud-quiz-label {{ display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 0.2rem; }}
    .hud-quiz-bar {{ height: 6px; border-radius: 99px; background: rgba(255,255,255,0.08); overflow: hidden; }}
    .hud-quiz-fill {{ height: 100%; width: 0%; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-dim)); transition: width 0.4s; }}
    .hud-missions {{ display: flex; gap: 0.3rem; flex-wrap: wrap; }}
    .mission-dot {{
      width: 34px; height: 34px; border-radius: 9px;
      border: 2px solid rgba(255,255,255,0.15);
      background: var(--bg-elevated);
      color: var(--text-muted);
      font-size: 0.72rem; font-weight: 700;
      display: grid; place-items: center;
      cursor: pointer;
    }}
    .mission-dot.done {{ border-color: var(--accent); color: var(--accent); box-shadow: 0 0 12px rgba({accent_rgba_08}, 0.25); }}
    .hud-mute {{ background: transparent; border: 1px solid rgba(255,255,255,0.15); color: var(--text-muted); border-radius: 8px; padding: 0.3rem 0.45rem; font-size: 0.72rem; cursor: pointer; }}

    .modal-overlay {{
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center;
      padding: 1rem; opacity: 0; pointer-events: none; transition: opacity 0.3s;
    }}
    .modal-overlay.active {{ opacity: 1; pointer-events: auto; }}
    .modal {{
      background: var(--bg-elevated);
      border: 1px solid {ch_border};
      border-radius: 16px;
      padding: 1.75rem;
      max-width: 400px;
      width: 100%;
    }}
    .modal h2 {{ margin: 0 0 0.5rem; font-size: 1.3rem; }}
    .modal p {{ margin: 0 0 1rem; color: var(--text-muted); font-size: 0.95rem; }}
    .modal input {{
      width: 100%; padding: 0.75rem 1rem; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: var(--bg); color: var(--text); font-family: inherit; margin-bottom: 1rem;
    }}
    .modal button.primary {{
      width: 100%; padding: 0.85rem; border: none; border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), {accent_hex});
      color: #0a0a0a; font-weight: 700; font-family: inherit; cursor: pointer;
    }}

    .victory-overlay {{
      position: fixed; inset: 0; z-index: 190;
      background: rgba(5, 8, 9, 0.88);
      display: flex; align-items: center; justify-content: center;
      padding: 1rem; opacity: 0; pointer-events: none; transition: opacity 0.4s;
    }}
    .victory-overlay.active {{ opacity: 1; pointer-events: auto; }}
    .victory-card {{ text-align: center; max-width: 420px; padding: 2rem; }}
    .victory-card h2 {{
      font-size: clamp(1.6rem, 4vw, 2.1rem); margin: 0 0 0.5rem;
      background: linear-gradient(135deg, #fde68a, var(--accent));
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }}
    .badge-row {{ display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin: 1.25rem 0; }}
    .mini-badge {{
      font-size: 0.72rem; padding: 0.35rem 0.65rem; border-radius: 99px;
      background: rgba({accent_rgba_08}, 0.12);
      border: 1px solid {ch_border};
      color: var(--accent-dim);
    }}
    .btn-dismiss {{
      padding: 0.75rem 1.5rem; border-radius: 10px; border: none;
      background: linear-gradient(135deg, var(--accent), {accent_hex});
      color: #0a0a0a; font-weight: 700; font-family: inherit; cursor: pointer;
    }}

    .confetti-layer {{ position: fixed; inset: 0; pointer-events: none; z-index: 195; overflow: hidden; }}
    .confetti-piece {{
      position: absolute; width: 8px; height: 12px; top: -20px;
      animation: confetti-fall 2.5s linear forwards;
    }}
    @keyframes confetti-fall {{
      to {{ transform: translateY(110vh) rotate(720deg); opacity: 0.9; }}
    }}

    .hero {{ padding: 2rem 0 1rem; }}
    .hero-badge {{ font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.65rem; }}
    .hero-greeting {{ font-size: 1.05rem; font-weight: 600; color: var(--accent); margin: 0 0 0.75rem; min-height: 1.35em; }}
    h1 {{ font-size: clamp(1.85rem, 1.2rem + 2vw, 2.5rem); font-weight: 700; letter-spacing: -0.03em; margin: 0 0 1rem; line-height: 1.15; }}
    .lead {{ color: var(--text-muted); max-width: 44ch; margin: 0 0 1.5rem; }}
    .hero-cta {{ display: flex; flex-wrap: wrap; gap: 0.65rem; }}
    .btn-primary {{
      padding: 0.65rem 1.1rem; border-radius: 10px; border: none;
      background: linear-gradient(135deg, var(--accent), {accent_hex});
      color: #0a0a0a; font-weight: 600; font-family: inherit; cursor: pointer;
    }}
    .btn-ghost {{
      padding: 0.65rem 1rem; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.15);
      background: transparent; color: var(--text-muted); font-family: inherit; cursor: pointer;
    }}

    section {{ padding: 2.25rem 0; border-top: 1px solid rgba(255,255,255,0.06); scroll-margin-top: calc(var(--hud-h) + 8px); }}
    .mission-tag {{
      display: inline-block;
      font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 0.5rem;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      border: 1px solid {ch_border};
    }}
    .mission-tag.done {{ background: rgba({accent_rgba_08}, 0.12); }}
    .kicker {{ font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-dim); margin-bottom: 0.35rem; }}
    h2 {{ font-size: clamp(1.3rem, 1rem + 1vw, 1.65rem); margin: 0 0 0.65rem; }}
    .intro {{ color: var(--text-muted); margin-bottom: 1rem; max-width: 52ch; }}

    .gce-challenge {{
      margin-top: 1.5rem;
      padding: 1.35rem;
      border-radius: 14px;
      background: linear-gradient(145deg, rgba({accent_rgba_08}, 0.08), rgba(5, 8, 9, 0.95));
      border: 1px solid {ch_border};
    }}
    .gce-challenge.complete {{ opacity: 0.95; }}
    .gce-head {{ display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 1rem; font-weight: 600; }}
    .xp-pill {{ font-size: 0.65rem; font-weight: 700; color: var(--gold); background: rgba(251, 191, 36, 0.12); padding: 0.15rem 0.45rem; border-radius: 6px; }}
    .gce-prompt {{ margin: 0 0 0.85rem; font-weight: 500; }}
    .choice-grid {{ display: grid; gap: 0.45rem; }}
    @media (min-width: 500px) {{ .choice-grid.cols-2 {{ grid-template-columns: 1fr 1fr; }} }}
    .choice-btn {{
      padding: 0.75rem 0.95rem;
      border-radius: 10px;
      border: 2px solid rgba(255, 255, 255, 0.1);
      background: var(--bg-elevated);
      color: var(--text);
      font-family: inherit;
      font-size: 0.92rem;
      text-align: left;
      cursor: pointer;
    }}
    .choice-btn:disabled {{ cursor: default; opacity: 0.88; }}
    .choice-btn.correct {{ border-color: var(--a); background: rgba(74, 222, 128, 0.12); }}
    .choice-btn.wrong {{ border-color: var(--t); background: rgba(251, 113, 133, 0.1); }}
    .gce-feedback {{ margin-top: 0.85rem; font-size: 0.88rem; display: none; padding: 0.65rem 0.85rem; border-radius: 10px; }}
    .gce-feedback.show {{ display: block; }}
    .gce-feedback.ok {{ background: rgba(74, 222, 128, 0.12); border: 1px solid rgba(74, 222, 128, 0.35); color: #86efac; }}
    .gce-feedback.no {{ background: rgba(251, 113, 133, 0.08); border: 1px solid rgba(251, 113, 133, 0.25); color: #fda4af; }}
    .btn-retry {{ margin-top: 0.4rem; padding: 0.35rem 0.65rem; font-size: 0.82rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: var(--text); cursor: pointer; font-family: inherit; }}

    .flashcard {{ margin-bottom: 0.75rem; border-radius: var(--radius); background: var(--bg-elevated); border: 1px solid rgba(255,255,255,0.07); border-left: 4px solid var(--accent); overflow: hidden; }}
    .flashcard-q {{ padding: 0.85rem 1rem; margin: 0; font-weight: 600; cursor: pointer; user-select: none; }}
    .flashcard-q::after {{ content: " ▾"; opacity: 0.5; }}
    .flashcard.open .flashcard-q::after {{ content: " ▴"; }}
    .flashcard-a {{ max-height: 0; overflow: hidden; transition: max-height 0.45s var(--ease-out); }}
    .flashcard.open .flashcard-a {{ max-height: 200px; }}
    .flashcard-a-inner {{ padding: 0 1rem 1rem; color: var(--text-muted); font-size: 0.92rem; }}

    .quiz-box {{ background: var(--bg-elevated); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 1.2rem 1.3rem; margin-bottom: 1.15rem; }}
    .quiz-box p:first-child {{ margin-top: 0; font-weight: 600; }}
    .quiz-opts {{ display: grid; gap: 0.45rem; }}
    @media(min-width:500px){{ .quiz-opts.cols-2 {{ grid-template-columns: 1fr 1fr; }} }}
    .quiz-opts button {{
      padding: 0.6rem 0.8rem; border-radius: 10px; border: 2px solid rgba(255,255,255,0.1);
      background: var(--bg); color: var(--text); font-family: inherit; font-size: 0.88rem; text-align: left; cursor: pointer;
    }}
    .quiz-opts button:disabled {{ opacity: 0.9; cursor: default; }}
    .quiz-opts button.ok {{ border-color: #4ade80; background: rgba(74,222,128,0.1); }}
    .quiz-opts button.bad {{ border-color: #fb7185; background: rgba(251,113,133,0.08); }}
    .explain {{ margin-top: 0.65rem; font-size: 0.85rem; color: var(--text-muted); max-height: 0; overflow: hidden; opacity: 0; transition: max-height 0.4s ease, opacity 0.3s; }}
    .explain.open {{ max-height: 140px; opacity: 1; }}

    .reveal {{ opacity: 0; transform: translateY(22px); transition: opacity 0.75s var(--ease-out), transform 0.75s var(--ease-out); }}
    .reveal.in-view {{ opacity: 1; transform: none; }}
    .d1 {{ transition-delay: 0.06s; }} .d2 {{ transition-delay: 0.12s; }}

    footer {{ text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem; border-top: 1px solid rgba(255,255,255,0.06); }}
  </style>
</head>
<body>
  <div id="codename-modal" class="modal-overlay" role="dialog" aria-labelledby="codename-title" aria-modal="true">
    <div class="modal">
      <h2 id="codename-title">{esc(modal_welcome)}</h2>
      <p>{modal_body}</p>
      <label class="sr-only" for="codename-input">Display name</label>
      <input id="codename-input" type="text" maxlength="24" placeholder="{esc(placeholder)}" autocomplete="nickname" />
      <button type="button" class="primary" id="codename-start">Enter</button>
    </div>
  </div>

  <div id="victory" class="victory-overlay" role="dialog" aria-labelledby="victory-title" aria-hidden="true">
    <div class="victory-card">
      <h2 id="victory-title">Unit complete</h2>
      <p id="victory-msg" style="color:var(--text-muted);margin:0 0 1rem;"></p>
      <div class="badge-row" id="victory-badges"></div>
      <button type="button" class="btn-dismiss" id="victory-dismiss">Continue</button>
    </div>
  </div>
  <div id="confetti-root" class="confetti-layer" aria-hidden="true"></div>

  <header class="game-hud" role="banner">
    <div class="hud-brand">
      <span id="gce-op-title">{esc(op_label)}</span>
      <span class="hud-codename" id="hud-codename" title=""></span>
    </div>
    <a href="{home_href}" class="hud-home-link">{esc(home_label)}</a>
    <div class="hud-xp-stack">
      <div class="hud-xp global">
        <div class="hud-xp-label"><span>Career XP</span><span id="hud-global-xp-text">0 / 2400</span></div>
        <div class="hud-xp-bar" role="progressbar" id="hud-global-xp-bar-wrap" aria-valuenow="0" aria-valuemin="0" aria-valuemax="2400">
          <div class="hud-xp-fill" id="hud-global-xp-fill"></div>
        </div>
      </div>
      <div class="hud-xp chapter">
        <div class="hud-xp-label"><span>This unit</span><span id="hud-chapter-xp-text">0 / 600</span></div>
        <div class="hud-xp-bar" role="progressbar" id="hud-chapter-xp-bar-wrap" aria-valuenow="0" aria-valuemin="0" aria-valuemax="600">
          <div class="hud-xp-fill" id="hud-chapter-xp-fill"></div>
        </div>
      </div>
    </div>
    <div class="hud-quiz" title="Checkpoint quiz">
      <div class="hud-quiz-label"><span>Quiz</span><span id="hud-quiz-text">0 / 4</span></div>
      <div class="hud-quiz-bar" role="progressbar" id="hud-quiz-bar-wrap" aria-valuenow="0" aria-valuemin="0" aria-valuemax="4">
        <div class="hud-quiz-fill" id="hud-quiz-fill"></div>
      </div>
    </div>
    <div class="hud-missions" id="hud-missions" aria-label="Missions"></div>
    <button type="button" class="hud-mute" id="btn-mute">Sound on</button>
  </header>

  <div class="wrap hero">
    <header>
      <p class="hero-badge reveal">{esc(title_full)}</p>
      <p class="hero-greeting reveal" id="hero-greeting"></p>
      <h1 class="reveal d1">{esc(h1)}</h1>
      <p class="lead reveal d2">{lead}</p>
      <div class="hero-cta reveal">
        <button type="button" class="btn-primary" id="btn-jump-m1">Start mission 1</button>
        <button type="button" class="btn-ghost" id="btn-edit-name">Change name</button>
      </div>
    </header>
  </div>

  <main class="wrap">
{chr(10).join(mission_sections)}

    <section id="flash">
      <p class="kicker reveal">Review</p>
      <h2 class="reveal d1">Flashcards</h2>
{flash_html}
    </section>

    <section id="quiz">
      <p class="kicker reveal">Checkpoint quiz</p>
      <h2 class="reveal d1">Four questions (+25 XP each)</h2>
{quiz_html}
    </section>
  </main>

  <footer>{esc(footer)}</footer>

  <script src="../js/{game_js}"></script>
  <script src="../js/nexus-academy.js"></script>
  <script src="../js/realm-lesson-boot.js"></script>
  <script>
    RealmLesson.init({{
      api: window.{api},
      lessonId: "{lesson_id}",
      storageKey: "{storage_key}",
      defaultName: "{default_name}",
      operationLabel: {json.dumps(op_label)},
      heroGreeting: {json.dumps(hero_greeting)},
      chapterTitle: "Unit complete",
      chapterMsg: {json.dumps(chapter_msg)},
      grandTitle: {json.dumps("Orbital Academy complete" if is_math else "Guild of the Lexicon complete")},
      grandMsg: {json.dumps(grand_msg)},
      chapterBadges: {json.dumps(chapter_badges)},
      grandBadges: {json.dumps(grand_badges)},
      missionOk: {json.dumps(mission_ok)},
      missionRetry: "Try again—use the briefing above.",
      confettiColors: {confetti}
    }});
    {script_record}
  </script>
</body>
</html>
"""


MATH_UNITS = [
    {
        "file": "unit-1.html",
        "lesson_id": "launch",
        "title_full": "Unit 1 · Launch Vector — Orbital Academy",
        "h1": "Ratios fuel every burn",
        "lead": "Compare quantities with <strong>ratios</strong> and scale with <strong>unit rates</strong>. Five missions, one quiz—same career XP bar as every unit.",
        "op_label": "Launch Vector",
        "hero_greeting": "{name}, plot ratios like trajectory math—steady hands.",
        "chapter_msg": "{name}, Launch Vector complete. Ready for transfer orbit.",
        "grand_msg": "{name}, you cleared Orbital Academy—every burn counted.",
        "modal_welcome": "Welcome, cadet",
        "modal_body": "Choose a <strong>call sign</strong>. Progress saves in this browser on this device.",
        "chapter_badges": '<span class="mini-badge">Ratio Rookie</span><span class="mini-badge">Unit Rate</span><span class="mini-badge">Scale Scout</span><span class="mini-badge">Table Pro</span><span class="mini-badge">Launch Ready</span>',
        "grand_badges": '<span class="mini-badge">Navigator</span><span class="mini-badge">Transfer</span><span class="mini-badge">Sensor Tech</span><span class="mini-badge">Geometry</span><span class="mini-badge">Orbital Ace</span>',
        "mission_ok": "{name}, solution locked.",
        "missions": [
            {
                "title": "What is a ratio?",
                "intro": "A <strong>ratio</strong> compares two quantities with the same unit—like 3 cups flour to 2 cups sugar, written 3:2.",
                "prompt": "Which pair is best expressed as a ratio?",
                "choices": [
                    ("3 apples and 5 miles", False),
                    ("4 hits in 10 at-bats", True),
                    ("Tuesday and Thursday", False),
                    ("Hot and cold", False),
                ],
            },
            {
                "title": "Equivalent ratios",
                "intro": "Multiply or divide both parts by the same nonzero number—you get an <strong>equivalent ratio</strong>.",
                "prompt": "Which ratio is equivalent to 2:3 ?",
                "choices": [("4:6", True), ("3:2", False), ("5:5", False), ("2:5", False)],
            },
            {
                "title": "Unit rate",
                "intro": "A <strong>unit rate</strong> tells “per one”—miles per gallon, dollars per pound.",
                "prompt": "You travel 180 miles in 3 hours. What is the unit rate in miles per hour?",
                "choices": [("60 mph", True), ("540 mph", False), ("90 mph", False), ("3 mph", False)],
            },
            {
                "title": "Tables & graphs",
                "intro": "Equivalent ratios line up in tables and plot as straight lines through the origin in simple proportional stories.",
                "prompt": "If 2 tickets cost $5, how much for 6 tickets at the same rate?",
                "choices": [("$15", True), ("$10", False), ("$30", False), ("$5", False)],
            },
            {
                "title": "Tape diagrams",
                "intro": "Tape diagrams split a bar into equal parts—great for seeing ratios visually.",
                "prompt": "In a 3:2 purple:green mix, how many parts total?",
                "choices": [("5 parts", True), ("3 parts", False), ("2 parts", False), ("6 parts", False)],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 1,
                "prompt": "A ratio compares…",
                "opts": ["Only lengths", "Two quantities in a multiplicative relationship", "Only fractions", "Only angles"],
                "explain": "Ratios compare two amounts—often with the same units.",
            },
            {
                "qi": 1,
                "ok": 2,
                "prompt": "4:5 is equivalent to…",
                "opts": ["8:6", "12:14", "12:15", "5:4"],
                "explain": "Multiply both parts by 3 → 12:15.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "Unit rate always means…",
                "opts": ["Per one of the second quantity", "Adding both numbers", "Doubling the ratio", "Ignoring units"],
                "explain": "Think “per 1” for the denominator you care about.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "If 5 notebooks cost $7.50, what is the price per notebook?",
                "opts": ["$7.50", "$2.50", "$0.67", "$1.50"],
                "explain": "7.50 ÷ 5 = 1.50 dollars per notebook.",
            },
        ],
        "flashcards": [
            ("What is a ratio?", "A <strong>comparison</strong> of two quantities, often written a:b."),
            ("What is a unit rate?", "A rate with a denominator of <strong>1</strong>—like miles per hour."),
            ("Equivalent ratios?", "Same relationship—scale both parts by the same factor."),
        ],
    },
    {
        "file": "unit-2.html",
        "lesson_id": "transfer",
        "title_full": "Unit 2 · Transfer Orbit — Orbital Academy",
        "h1": "Proportions & linear patterns",
        "lead": "When two quantities stay in proportion, you can predict unknowns with equations and graphs.",
        "op_label": "Transfer Orbit",
        "hero_greeting": "{name}, match your slope—constant of proportionality ahead.",
        "chapter_msg": "{name}, transfer burn complete. Sensors next.",
        "grand_msg": "{name}, you cleared Orbital Academy—every burn counted.",
        "modal_welcome": "Welcome, cadet",
        "modal_body": "Choose a <strong>call sign</strong>. Progress saves locally in this browser.",
        "chapter_badges": '<span class="mini-badge">k master</span><span class="mini-badge">Proportion</span><span class="mini-badge">Line Sense</span><span class="mini-badge">y = kx</span><span class="mini-badge">Transfer OK</span>',
        "grand_badges": '<span class="mini-badge">Navigator</span><span class="mini-badge">Transfer</span><span class="mini-badge">Sensor Tech</span><span class="mini-badge">Geometry</span><span class="mini-badge">Orbital Ace</span>',
        "mission_ok": "{name}, burn nominal.",
        "missions": [
            {
                "title": "Proportional relationships",
                "intro": "If y is always k times x, the relationship is <strong>proportional</strong>; k is the constant of proportionality.",
                "prompt": "y = 4x. What is y when x = 7?",
                "choices": [("28", True), ("11", False), ("3", False), ("47", False)],
            },
            {
                "title": "Tables",
                "intro": "Check whether all rows have the same ratio y:x.",
                "prompt": "Which table could show a proportional relationship?",
                "choices": [
                    ("x 1,2,3 and y 3,6,9", True),
                    ("x 1,2,3 and y 2,4,7", False),
                    ("x 1,1,1 and y 2,3,4", False),
                    ("x 0,1 and y 1,3 only", False),
                ],
            },
            {
                "title": "Graphs",
                "intro": "Proportional relationships graph as lines through the origin (in many middle-school contexts).",
                "prompt": "A proportional line through the origin has slope equal to…",
                "choices": [
                    ("the constant of proportionality", True),
                    ("always zero", False),
                    ("the y-intercept only", False),
                    ("area", False),
                ],
            },
            {
                "title": "Equations",
                "intro": "Translate words to y = kx when quantities stay proportional.",
                "prompt": "A recipe uses 2 cups milk for 3 cups flour. If flour is x and milk is y, which equation fits a proportional story?",
                "choices": [
                    ("y = (2/3)x when comparing to flour as x", True),
                    ("y = x + 2", False),
                    ("y = 3/x", False),
                    ("y = 2", False),
                ],
            },
            {
                "title": "Non-examples",
                "intro": "If adding a fixed fee breaks through-origin, it may not be proportional from zero.",
                "prompt": "Which is usually NOT proportional?",
                "choices": [
                    ("Cost = $5 per shirt with no fee", False),
                    ("Cost = $5 per shirt plus $2 flat fee from 0 items", True),
                    ("Distance = 60 miles per hour × hours", False),
                    ("Meters = 100 × centimeters", False),
                ],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 2,
                "prompt": "Constant of proportionality k in y = kx means…",
                "opts": ["y + x", "y ÷ x when proportional", "x − y", "Always 1"],
                "explain": "k is the factor relating y to x.",
            },
            {
                "qi": 1,
                "ok": 1,
                "prompt": "A line through (0,0) and (2,6) has slope…",
                "opts": ["2", "3", "6", "0"],
                "explain": "Rise/run = 6/2 = 3.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "Which point must a proportional graph through the origin pass?",
                "opts": ["(0,0)", "(1,0)", "(0,1)", "(2,2)"],
                "explain": "Zero input → zero output in proportional stories from zero.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "If 8 ounces cost $2, unit price is…",
                "opts": ["$8 per oz", "$0.25 per oz", "$4 per oz", "$0.25 per oz — wait, recalc: $2/8 = $0.25/oz", False],
                "explain": "2 ÷ 8 = 0.25 dollars per ounce.",
            },
        ],
        "flashcards": [
            ("Proportional?", "y = kx through the origin in many textbook setups."),
            ("k", "The factor in y = kx."),
            ("Graph clue", "Straight line through origin when both variables start at zero."),
        ],
    },
]

# Fix unit-2 quiz 4 - I made a mistake - options need 4 strings with one true
MATH_UNITS[1]["quizzes"][3] = {
    "qi": 3,
    "ok": 1,
    "prompt": "If 8 ounces cost $2, the unit price is…",
    "opts": ["$0.25 per ounce", "$4 per ounce", "$16 per ounce", "$6 per ounce"],
    "explain": "2 dollars ÷ 8 ounces = $0.25 per ounce.",
}

# Fix badge typo in unit 2
MATH_UNITS[1]["chapter_badges"] = '<span class="mini-badge">k Master</span><span class="mini-badge">Proportion</span><span class="mini-badge">Line Sense</span><span class="mini-badge">y = kx</span><span class="mini-badge">Transfer OK</span>'

MATH_UNITS += [
    {
        "file": "unit-3.html",
        "lesson_id": "sensors",
        "title_full": "Unit 3 · Sensor Array — Orbital Academy",
        "h1": "Data from the void",
        "lead": "Summarize data with center, spread, and simple probability models.",
        "op_label": "Sensor Array",
        "hero_greeting": "{name}, read the noise—means and more.",
        "chapter_msg": "{name}, sensors calibrated. Geometry sector ahead.",
        "grand_msg": "{name}, you cleared Orbital Academy—every burn counted.",
        "modal_welcome": "Welcome, cadet",
        "modal_body": "Choose a <strong>call sign</strong>. Progress saves locally.",
        "chapter_badges": '<span class="mini-badge">Mean</span><span class="mini-badge">Median</span><span class="mini-badge">Range</span><span class="mini-badge">Dot Plot</span><span class="mini-badge">Sensor Sync</span>',
        "grand_badges": '<span class="mini-badge">Navigator</span><span class="mini-badge">Transfer</span><span class="mini-badge">Sensor Tech</span><span class="mini-badge">Geometry</span><span class="mini-badge">Orbital Ace</span>',
        "mission_ok": "{name}, data locked.",
        "missions": [
            {
                "title": "Mean",
                "intro": "The <strong>mean</strong> is the average—sum divided by count.",
                "prompt": "Data: 4, 8, 8, 10. What is the mean?",
                "choices": [("7.5", True), ("8", False), ("10", False), ("30", False)],
            },
            {
                "title": "Median",
                "intro": "The <strong>median</strong> is the middle value when data are ordered.",
                "prompt": "Ordered data: 3, 7, 9, 12, 20. What is the median?",
                "choices": [("9", True), ("7", False), ("10.2", False), ("20", False)],
            },
            {
                "title": "Range",
                "intro": "Range = max − min.",
                "prompt": "Scores: 14, 18, 22. What is the range?",
                "choices": [("8", True), ("18", False), ("22", False), ("54", False)],
            },
            {
                "title": "Simple probability",
                "intro": "Probability of an event = favorable outcomes / total equally likely outcomes.",
                "prompt": "A fair number cube (1–6). P(rolling an even number)?",
                "choices": [("1/2", True), ("1/3", False), ("1/6", False), ("2/3", False)],
            },
            {
                "title": "Samples",
                "intro": "A <strong>random sample</strong> helps generalize to a population—if done well.",
                "prompt": "Why randomize a sample?",
                "choices": [
                    ("Reduce bias and improve representativeness", True),
                    ("Guarantee perfect accuracy always", False),
                    ("Make the sample smaller always", False),
                    ("Remove all variability", False),
                ],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 2,
                "prompt": "Which is most affected by a single very large outlier?",
                "opts": ["Median", "Mode", "Mean", "Range only"],
                "explain": "The mean shifts with extreme values.",
            },
            {
                "qi": 1,
                "ok": 1,
                "prompt": "Probability must be between…",
                "opts": ["0 and 10", "0 and 1 inclusive", "1 and 100 always", "−1 and 1"],
                "explain": "0 ≤ P ≤ 1 for standard probability models.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "A dot plot shows…",
                "opts": ["Each data value as a dot along a number line", "Only the mean", "Only pie slices", "Only 3D shapes"],
                "explain": "Dots stack for repeats.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "Flip a fair coin. P(heads) =",
                "opts": ["0", "1/4", "1/3", "1/2"],
                "explain": "Two equally likely outcomes.",
            },
        ],
        "flashcards": [
            ("Mean", "Sum ÷ count."),
            ("Median", "Middle when sorted."),
            ("Range", "Max − min."),
        ],
    },
    {
        "file": "unit-4.html",
        "lesson_id": "geometry",
        "title_full": "Unit 4 · Geometry Sector — Orbital Academy",
        "h1": "Measure the mission space",
        "lead": "Area, surface area, volume, and the Pythagorean theorem for right triangles.",
        "op_label": "Geometry Sector",
        "hero_greeting": "{name}, square the corners—measure twice.",
        "chapter_msg": "{name}, geometry sector secure. Orbit mastered.",
        "grand_msg": "{name}, you cleared Orbital Academy—every burn counted.",
        "modal_welcome": "Welcome, cadet",
        "modal_body": "Choose a <strong>call sign</strong>. Progress saves locally.",
        "chapter_badges": '<span class="mini-badge">Area</span><span class="mini-badge">Volume</span><span class="mini-badge">SA</span><span class="mini-badge">Pythagoras</span><span class="mini-badge">Sector Clear</span>',
        "grand_badges": '<span class="mini-badge">Navigator</span><span class="mini-badge">Transfer</span><span class="mini-badge">Sensor Tech</span><span class="mini-badge">Geometry</span><span class="mini-badge">Orbital Ace</span>',
        "mission_ok": "{name}, measures verified.",
        "missions": [
            {
                "title": "Rectangle area",
                "intro": "Area of rectangle = length × width.",
                "prompt": "A rectangle is 7 cm by 4 cm. Area?",
                "choices": [("28 cm²", True), ("11 cm²", False), ("22 cm²", False), ("14 cm²", False)],
            },
            {
                "title": "Triangle area",
                "intro": "Area of triangle = (1/2) × base × height.",
                "prompt": "Base 10 in, height 6 in. Area?",
                "choices": [("30 in²", True), ("60 in²", False), ("16 in²", False), ("5 in²", False)],
            },
            {
                "title": "Circle circumference",
                "intro": "C = 2πr (use π ≈ 3.14 for estimates).",
                "prompt": "Radius 5 m. Approximate circumference?",
                "choices": [("31.4 m", True), ("15.7 m", False), ("78.5 m", False), ("10 m", False)],
            },
            {
                "title": "Rectangular prism volume",
                "intro": "V = length × width × height.",
                "prompt": "3 × 4 × 5 prism. Volume?",
                "choices": [("60 cubic units", True), ("12 cubic units", False), ("20 cubic units", False), ("47 cubic units", False)],
            },
            {
                "title": "Pythagorean theorem",
                "intro": "For a right triangle, a² + b² = c² where c is the hypotenuse.",
                "prompt": "Legs 6 and 8. Hypotenuse?",
                "choices": [("10", True), ("14", False), ("100", False), ("12", False)],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 2,
                "prompt": "Area of a circle radius 3 (use π≈3.14)?",
                "opts": ["9.42", "18.84", "28.26", "31.4"],
                "explain": "πr² ≈ 3.14×9 = 28.26.",
            },
            {
                "qi": 1,
                "ok": 1,
                "prompt": "Surface area adds up areas of…",
                "opts": ["Only the bottom", "All faces", "Only edges", "Only vertices"],
                "explain": "Net of faces.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "A right triangle with legs 5 and 12 has hypotenuse…",
                "opts": ["13", "17", "60", "7"],
                "explain": "5²+12²=169 → 13.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "Volume of cylinder V = πr²h with r=2, h=4 (π≈3.14)?",
                "opts": ["12.56", "25.12", "50.24", "50.24 — check: π×4×4≈50.24"],
                "explain": "π×4×4 ≈ 50.24.",
            },
        ],
        "flashcards": [
            ("A = lw", "Rectangle."),
            ("a²+b²=c²", "Right triangle."),
            ("V = lwh", "Rectangular prism."),
        ],
    },
]

# fix unit 4 quiz 4 options - remove duplicate
MATH_UNITS[3]["quizzes"][3] = {
    "qi": 3,
    "ok": 2,
    "prompt": "Volume of a cylinder: V = πr²h with r = 2, h = 4 (π ≈ 3.14)?",
    "opts": ["12.56", "25.12", "≈50.24", "100.48"],
    "explain": "π × 2² × 4 = 16π ≈ 50.24.",
}


ELA_UNITS = [
    {
        "file": "unit-1.html",
        "lesson_id": "map",
        "title_full": "Unit 1 · Realm Map — Guild of the Lexicon",
        "h1": "Plot, setting, theme",
        "lead": "Stories have structure. Map the terrain before you argue or polish sentences.",
        "op_label": "Realm Map",
        "hero_greeting": "{name}, chart the story—setting lights the path.",
        "chapter_msg": "{name}, the map is yours. Voices await.",
        "grand_msg": "{name}, the Lexicon knows your name—every sigil earned.",
        "modal_welcome": "Welcome, hero",
        "modal_body": "Choose a <strong>hero name</strong>. Progress saves locally in this browser.",
        "chapter_badges": '<span class="mini-badge">Plot</span><span class="mini-badge">Setting</span><span class="mini-badge">Theme</span><span class="mini-badge">Conflict</span><span class="mini-badge">Cartographer</span>',
        "grand_badges": '<span class="mini-badge">Map</span><span class="mini-badge">Voices</span><span class="mini-badge">Forge</span><span class="mini-badge">Sigils</span><span class="mini-badge">Guild Master</span>',
        "mission_ok": "{name}, passage marked.",
        "missions": [
            {
                "title": "Plot vs theme",
                "intro": "<strong>Plot</strong> is what happens; <strong>theme</strong> is the insight about life or human nature the story suggests.",
                "prompt": "Which best describes a theme?",
                "choices": [
                    ("Courage can cost comfort", True),
                    ("The hero opened the door at 7:02 p.m.", False),
                    ("Chapter 3 has 12 pages", False),
                    ("The cover is blue", False),
                ],
            },
            {
                "title": "Setting",
                "intro": "Setting includes time, place, and sometimes mood or social world.",
                "prompt": "“A rainy coastal town in 1920” mainly establishes…",
                "choices": [("Setting", True), ("Theme", False), ("Climax", False), ("Author’s birthday", False)],
            },
            {
                "title": "Conflict",
                "intro": "Conflict drives plot—internal or external struggle.",
                "prompt": "A character wrestles with fear of speaking up. That is mostly…",
                "choices": [
                    ("Internal conflict", True),
                    ("Exposition only", False),
                    ("Setting", False),
                    ("A type of meter", False),
                ],
            },
            {
                "title": "Sequence",
                "intro": "Common plot parts: exposition, rising action, climax, falling action, resolution.",
                "prompt": "The turning point of highest tension is usually the…",
                "choices": [("Climax", True), ("Exposition", False), ("Title page", False), ("Copyright", False)],
            },
            {
                "title": "Evidence",
                "intro": "Claims about theme need textual evidence—quotes or paraphrase tied to events.",
                "prompt": "Which supports a claim about theme best?",
                "choices": [
                    ("A pattern of choices the character repeats with consequences", True),
                    ("The font size on page 1", False),
                    ("How many chapters exist", False),
                    ("The book’s price", False),
                ],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 1,
                "prompt": "Theme is usually stated as…",
                "opts": ["A single object only", "A complete sentence about a big idea", "Only dialogue tags", "The ISBN"],
                "explain": "Themes are interpretive claims—often full sentences.",
            },
            {
                "qi": 1,
                "ok": 2,
                "prompt": "Mood is…",
                "opts": ["The moral", "The narrator’s name", "The feeling the reader gets", "Only the year printed"],
                "explain": "Atmosphere/feeling.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "First-person narration uses pronouns like…",
                "opts": ["I / we", "He / she only", "They only", "You for everyone"],
                "explain": "Inside a character’s perspective.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "A story’s central message about life is closest to…",
                "opts": ["A footnote", "Word count", "Copyright date", "Theme"],
                "explain": "Theme—interpret carefully with evidence.",
            },
        ],
        "flashcards": [
            ("Plot", "What happens."),
            ("Theme", "So what—big idea."),
            ("Setting", "When and where (and mood/world)."),
        ],
    },
    {
        "file": "unit-2.html",
        "lesson_id": "voices",
        "title_full": "Unit 2 · Chorus of Voices — Guild of the Lexicon",
        "h1": "Point of view & tone",
        "lead": "Who tells the story—and how does it sound? Precision starts with voice.",
        "op_label": "Chorus of Voices",
        "hero_greeting": "{name}, tune your ear—tone carries meaning.",
        "chapter_msg": "{name}, voices harmonized. The forge awaits.",
        "grand_msg": "{name}, the Lexicon knows your name—every sigil earned.",
        "modal_welcome": "Welcome, hero",
        "modal_body": "Choose a <strong>hero name</strong>. Progress saves locally.",
        "chapter_badges": '<span class="mini-badge">1st person</span><span class="mini-badge">3rd limited</span><span class="mini-badge">Omniscient</span><span class="mini-badge">Tone</span><span class="mini-badge">Speaker</span>',
        "grand_badges": '<span class="mini-badge">Map</span><span class="mini-badge">Voices</span><span class="mini-badge">Forge</span><span class="mini-badge">Sigils</span><span class="mini-badge">Guild Master</span>',
        "mission_ok": "{name}, voice noted.",
        "missions": [
            {
                "title": "First vs third",
                "intro": "<strong>First person</strong> uses I/we; <strong>third</strong> uses he/she/they.",
                "prompt": "“I shivered as the door creaked.” This is…",
                "choices": [("First person", True), ("Second person", False), ("Omniscient only", False), ("Objective only", False)],
            },
            {
                "title": "Third limited",
                "intro": "Third-person limited sticks closely to one character’s perceptions.",
                "prompt": "We only know one character’s thoughts on the page. Likely…",
                "choices": [
                    ("Third-person limited", True),
                    ("Second person", False),
                    ("Dramatic irony always", False),
                    ("Recipe", False),
                ],
            },
            {
                "title": "Tone",
                "intro": "<strong>Tone</strong> is the author’s attitude toward the subject—serious, playful, ironic…",
                "prompt": "Sarcastic word choices usually signal…",
                "choices": [("A particular tone", True), ("Always a happy theme", False), ("Only setting", False), ("Only plot", False)],
            },
            {
                "title": "Mood vs tone",
                "intro": "Mood is reader feeling; tone is author attitude—related but not identical.",
                "prompt": "“The room felt suffocating” leans toward describing…",
                "choices": [("Mood", True), ("A math ratio", False), ("A thesis statement", False), ("A bibliography", False)],
            },
            {
                "title": "Unreliable narrator",
                "intro": "Sometimes the narrator’s view is biased or mistaken—watch for clues.",
                "prompt": "If details contradict the narrator’s claims, readers may infer…",
                "choices": [
                    ("Unreliability or complexity", True),
                    ("The book has no words", False),
                    ("Third person is illegal", False),
                    ("Theme is impossible", False),
                ],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 2,
                "prompt": "Second-person narration often uses…",
                "opts": ["He", "She", "You", "We only"],
                "explain": "Direct address to the reader or character as “you.”",
            },
            {
                "qi": 1,
                "ok": 1,
                "prompt": "An objective narrator typically…",
                "opts": ["Shares every thought in the universe", "Reports actions/dialogue without inner thoughts", "Always uses I", "Writes only in poetry"],
                "explain": "Camera-like reporting.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "Word choice, imagery, and rhythm contribute to…",
                "opts": ["Tone and style", "Only page numbers", "Only margins", "ISBN"],
                "explain": "Craft shapes how we hear the story.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 1,
                "prompt": "If the narrator says one thing but events show another, that can create…",
                "opts": ["A table of contents", "Irony or dramatic tension", "A bibliography", "A ratio"],
                "explain": "Gap between saying and showing.",
            },
        ],
        "flashcards": [
            ("Tone", "Author attitude."),
            ("Mood", "Reader feeling."),
            ("POV", "Who tells / sees."),
        ],
    },
    {
        "file": "unit-3.html",
        "lesson_id": "forge",
        "title_full": "Unit 3 · Syntax Forge — Guild of the Lexicon",
        "h1": "Sentences that hold",
        "lead": "Clauses, phrases, and punctuation—forge clear sentences for arguments and stories.",
        "op_label": "Syntax Forge",
        "hero_greeting": "{name}, strike true—subject meets predicate.",
        "chapter_msg": "{name}, forge cooled. Sigils next.",
        "grand_msg": "{name}, the Lexicon knows your name—every sigil earned.",
        "modal_welcome": "Welcome, hero",
        "modal_body": "Choose a <strong>hero name</strong>. Progress saves locally.",
        "chapter_badges": '<span class="mini-badge">Clause</span><span class="mini-badge">Phrase</span><span class="mini-badge">Fragment</span><span class="mini-badge">Run-on</span><span class="mini-badge">Smith</span>',
        "grand_badges": '<span class="mini-badge">Map</span><span class="mini-badge">Voices</span><span class="mini-badge">Forge</span><span class="mini-badge">Sigils</span><span class="mini-badge">Guild Master</span>',
        "mission_ok": "{name}, sentence forged.",
        "missions": [
            {
                "title": "Independent clause",
                "intro": "Has a subject and predicate and can stand alone as a sentence.",
                "prompt": "Which is a full sentence?",
                "choices": [
                    ("The comet streaked across the sky.", True),
                    ("Running through the field.", False),
                    ("Because the bell rang.", False),
                    ("Although quiet.", False),
                ],
            },
            {
                "title": "Fragment",
                "intro": "A fragment is missing a complete thought or needed connection.",
                "prompt": "“After the storm.” This is…",
                "choices": [("A fragment", True), ("A complete sentence", False), ("A novel", False), ("A thesis", False)],
            },
            {
                "title": "Comma splice",
                "intro": "Two independent clauses jammed with only a comma—often fixed with a semicolon, period, or conjunction.",
                "prompt": "“I ran, I jumped.” is commonly labeled…",
                "choices": [
                    ("Comma splice (needs stronger join)", True),
                    ("Perfect as-is always", False),
                    ("A fragment", False),
                    ("A phrase only", False),
                ],
            },
            {
                "title": "Compound sentence",
                "intro": "Two independent clauses joined properly (e.g., comma + FANBOYS, or semicolon).",
                "prompt": "Which is a properly joined compound in many classrooms?",
                "choices": [
                    ("I read, and I wrote.", True),
                    ("I read I wrote.", False),
                    ("I read, I wrote with only a comma and no FANBOYS", False),
                    ("Reading writing", False),
                ],
            },
            {
                "title": "Phrase vs clause",
                "intro": "A clause has a subject and verb; a phrase does not have both in the same unit.",
                "prompt": "“Walking to school” is…",
                "choices": [
                    ("A phrase (no full clause on its own)", True),
                    ("An independent clause", False),
                    ("A bibliography", False),
                    ("A thesis", False),
                ],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 1,
                "prompt": "A dependent clause…",
                "opts": ["Always stands alone", "Cannot stand alone as a complete sentence", "Has no verb", "Is always a title"],
                "explain": "Needs an independent clause or context.",
            },
            {
                "qi": 1,
                "ok": 2,
                "prompt": "FANBOYS are…",
                "opts": ["Only adjectives", "Only nouns", "Coordinating conjunctions", "Punctuation marks"],
                "explain": "For, And, Nor, But, Or, Yet, So.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "A run-on may be…",
                "opts": ["Fused independent clauses without proper punctuation/conjunctions", "Any long sentence", "Any short sentence", "Only poetry"],
                "explain": "Two (or more) independents crashed together.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "Which revision often fixes a comma splice?",
                "opts": ["Add nothing", "Remove all verbs", "Use only commas forever", "Use a period or semicolon, or add a coordinating conjunction"],
                "explain": "Give each independent its due boundary.",
            },
        ],
        "flashcards": [
            ("Clause", "Subject + verb (may be dependent or independent)."),
            ("Fragment", "Incomplete thought as a sentence."),
            ("Comma splice", "Two independents with only a comma."),
        ],
    },
    {
        "file": "unit-4.html",
        "lesson_id": "sigils",
        "title_full": "Unit 4 · Sigils & Symbols — Guild of the Lexicon",
        "h1": "Figurative power",
        "lead": "Metaphor, simile, symbol—read like a craftsperson, not a robot.",
        "op_label": "Sigils & Symbols",
        "hero_greeting": "{name}, read the hidden marks—symbols speak.",
        "chapter_msg": "{name}, sigils mastered. Lexicon complete.",
        "grand_msg": "{name}, the Lexicon knows your name—every sigil earned.",
        "modal_welcome": "Welcome, hero",
        "modal_body": "Choose a <strong>hero name</strong>. Progress saves locally.",
        "chapter_badges": '<span class="mini-badge">Simile</span><span class="mini-badge">Metaphor</span><span class="mini-badge">Symbol</span><span class="mini-badge">Imagery</span><span class="mini-badge">Archivist</span>',
        "grand_badges": '<span class="mini-badge">Map</span><span class="mini-badge">Voices</span><span class="mini-badge">Forge</span><span class="mini-badge">Sigils</span><span class="mini-badge">Guild Master</span>',
        "mission_ok": "{name}, sigil recognized.",
        "missions": [
            {
                "title": "Simile",
                "intro": "Compares using <strong>like</strong> or <strong>as</strong>.",
                "prompt": "“Quiet as snow” is…",
                "choices": [("A simile", True), ("A metaphor", False), ("A bibliography", False), ("A ratio", False)],
            },
            {
                "title": "Metaphor",
                "intro": "Speaks as if one thing <em>is</em> another—no like/as.",
                "prompt": "“Time is a thief” is…",
                "choices": [("A metaphor", True), ("A simile", False), ("A footnote", False), ("A thesis paragraph", False)],
            },
            {
                "title": "Symbol",
                "intro": "An object, color, or image that suggests larger meaning.",
                "prompt": "A recurring green light across the water might function as…",
                "choices": [("A symbol", True), ("Only a color word", False), ("A math variable only", False), ("A spelling error", False)],
            },
            {
                "title": "Imagery",
                "intro": "Sensory language—sight, sound, smell, touch, taste.",
                "prompt": "“The air tasted of salt and metal” leans on…",
                "choices": [("Imagery", True), ("Only dialogue tags", False), ("Only plot order", False), ("ISBN", False)],
            },
            {
                "title": "Connotation",
                "intro": "The feelings and associations a word carries beyond dictionary definition.",
                "prompt": "“Slender” vs “skinny” often differs in…",
                "choices": [("Connotation", True), ("Spelling only", False), ("Syllable count only", False), ("Font", False)],
            },
        ],
        "quizzes": [
            {
                "qi": 0,
                "ok": 2,
                "prompt": "Personification gives…",
                "opts": ["Only facts", "Human traits to nonhuman things", "Only verbs to nouns", "ISBNs to characters"],
                "explain": "Animating the nonhuman.",
            },
            {
                "qi": 1,
                "ok": 1,
                "prompt": "Alliteration repeats…",
                "opts": ["Whole paragraphs", "Consonant sounds at stressed syllable starts", "Only numbers", "Only end rhymes"],
                "explain": "Sound pattern at beginnings.",
                "delay": " d1",
            },
            {
                "qi": 2,
                "ok": 0,
                "prompt": "Extended metaphor sustained across lines is also called a…",
                "opts": ["Conceit (in many classrooms)", "Bibliography", "Table of contents", "Ratio"],
                "explain": "An extended comparison network.",
                "delay": " d2",
            },
            {
                "qi": 3,
                "ok": 3,
                "prompt": "A symbol’s meaning is often…",
                "opts": ["Only one fixed dictionary definition for all readers always", "Interpretive with textual support", "Random", "Impossible"],
                "explain": "Interpret responsibly with evidence.",
            },
        ],
        "flashcards": [
            ("Simile", "Like / as."),
            ("Metaphor", "Direct equation of unlike things."),
            ("Symbol", "Object/image → bigger idea."),
        ],
    },
]


def main() -> None:
    for u in MATH_UNITS:
        html = page(
            realm="math",
            filename=u["file"],
            title_full=u["title_full"],
            h1=u["h1"],
            lead=u["lead"],
            lesson_id=u["lesson_id"],
            op_label=u["op_label"],
            storage_key="orbitalAcademy_v1",
            default_name="Cadet",
            modal_welcome=u["modal_welcome"],
            modal_body=u["modal_body"],
            placeholder="Your call sign",
            home_href="hub.html",
            home_label="← Units",
            hero_greeting=u["hero_greeting"],
            chapter_msg=u["chapter_msg"],
            grand_msg=u["grand_msg"],
            chapter_badges=u["chapter_badges"],
            grand_badges=u["grand_badges"],
            mission_ok=u["mission_ok"],
            missions=u["missions"],
            quizzes=u["quizzes"],
            flashcards=u["flashcards"],
            footer="Orbital Academy · Middle school math · Local progress",
            api="OrbitalGame",
            confetti=json.dumps(["#38bdf8", "#22d3ee", "#a5f3fc", "#fbbf24", "#818cf8"]),
        )
        path = os.path.join(ROOT, "math", u["file"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)

    for u in ELA_UNITS:
        html = page(
            realm="ela",
            filename=u["file"],
            title_full=u["title_full"],
            h1=u["h1"],
            lead=u["lead"],
            lesson_id=u["lesson_id"],
            op_label=u["op_label"],
            storage_key="lexiconGuild_v1",
            default_name="Hero",
            modal_welcome=u["modal_welcome"],
            modal_body=u["modal_body"],
            placeholder="Hero name",
            home_href="hub.html",
            home_label="← Units",
            hero_greeting=u["hero_greeting"],
            chapter_msg=u["chapter_msg"],
            grand_msg=u["grand_msg"],
            chapter_badges=u["chapter_badges"],
            grand_badges=u["grand_badges"],
            mission_ok=u["mission_ok"],
            missions=u["missions"],
            quizzes=u["quizzes"],
            flashcards=u["flashcards"],
            footer="Guild of the Lexicon · Middle school ELA · Local progress",
            api="LexiconGame",
            confetti=json.dumps(["#f59e0b", "#fbbf24", "#fb7185", "#a78bfa", "#fde68a"]),
        )
        path = os.path.join(ROOT, "ela", u["file"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)

    print("Wrote math/unit-1..4 and ela/unit-1..4")


if __name__ == "__main__":
    main()
