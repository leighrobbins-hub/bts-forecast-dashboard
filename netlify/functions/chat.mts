import type { Context } from "@netlify/functions";

// Anthropic Messages API proxy. Lives server-side so the API key never
// reaches the browser. Mirrors the auth + dev-mode pattern used by
// roadmap.mts: real Netlify Identity tokens on prod, an open dev user when
// running `netlify dev` locally.
//
// Env vars:
//   ANTHROPIC_API_KEY   – required for live responses
//   ANTHROPIC_MODEL     – optional (default: claude-3-5-sonnet-20241022)
//   ANTHROPIC_MAX_TOKENS – optional (default: 1024)
//   ADMIN_EMAILS        – comma-separated; combined with the default list
//
// Body shape (POST):
//   {
//     messages: [{ role: "user" | "assistant", content: string }, ...],
//     systemPrompt?: string,        // optional override / addition
//     contextSnapshot?: string,     // dashboard context injected by client
//     model?: string,               // optional override
//     maxTokens?: number            // optional override
//   }
//
// Response (200):
//   {
//     reply: string,
//     model: string,
//     usage: { input_tokens, output_tokens },
//     stopReason: string | null
//   }

const DEFAULT_ADMIN_EMAILS = ["leigh.robbins@varsitytutors.com"];
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const DEFAULT_MAX_TOKENS = 1024;
const DATA_CACHE_TTL_MS = 60 * 1000; // refresh dashboard data once per minute per warm function instance
const TAIL_END_TARGET_MAX = 3;
const TAIL_END_BTS_MAX = 10;

const BASE_SYSTEM_PROMPT = `You are the Dashboard Assistant for the BTS (Back To School) Tutor Supply Forecasting Dashboard.

Your job is to help operators understand and act on:
- subject pacing (Behind / On Pace / Complete / Awaiting Data / Tail-End),
- recommended actions (Recruit, Investigate, High Wait Time, Reduce Forecast, On Track),
- the difference between BTS-season classifications and monthly classifications,
- weekly business review (WBR) numbers and how they're computed,
- Looker-derived metrics like Run Rate, Tutor Hours Utilization (THU), P90 Time-to-Assign, New Tutor Placement, and Util Rate,
- which subjects to prioritize this week and why.

The system prompt below contains a <DATA_PACK> block with the complete dataset the dashboard renders from — every subject, every Looker metric, every monthly tracker row, every recommendation, the WBR summary, the portfolio summary, and data freshness. You can answer detailed questions ("what's LSAT's P90?", "list every CORE subject behind pace", "compare run rate vs target across Test Prep") directly from that data. The <CURRENT_VIEW> block tells you what tab the operator is on right now — use it to keep answers relevant to what they're looking at.

Style:
- Be concise. Default to short paragraphs and bulleted answers. When listing subjects, prefer compact tables.
- Cite specific subject names and numbers from the data pack.
- If the user asks for something not in the data pack (e.g., individual tutor names, raw events), say so and suggest where in the dashboard or Looker to look.
- Never invent subject names, counts, or trends. If you don't know, say "I don't have that in the current data."
- Spell out THU as "Tutor Hours Utilization" the first time you use it.
- When the operator asks "what should I do this week" or similar, lead with the Recruit/Investigate items (high priority), then Behind Pace items, then anything with worsening trend.

Tail-End rule (important):
- A subject with monthly target ≤ ${TAIL_END_TARGET_MAX} OR BTS_Total ≤ ${TAIL_END_BTS_MAX} is a "Tail-End" subject and is excluded from headline counts like Behind Pace, On Pace, Awaiting Data, Investigate, and Reduce Forecast.
- The Recruit, On Track, High Wait Time, and Complete tiles still INCLUDE tail-end subjects (carve-outs).
- Tail-End subjects also unconditionally appear in the dedicated Tail-End tile, so a single tail-end subject can show in two tiles.

Action vocabulary (Primary_Action values from the data pack):
- "Recruit More" / "Recruit More — Urgent" → run rate short of target; possibly with capacity also stressed (urgent variant).
- "Investigate — Wait Times" → P90 above goal; supply may exist but isn't matching demand fast enough.
- "Investigate — Capacity Available" → run rate gap but utilization low; investigate why the existing pool isn't absorbing demand before adding more tutors.
- "Reduce Forecast" → run rate meets/exceeds target and utilization is low; consider trimming the forecast.
- "On Track" → supply healthy, util healthy, P90 within goal.
- "On Track — High Wait" → on track on volume but wait times still elevated.

Pace vocabulary (monthly):
- behind = projected end-of-month total < monthly target (and not tail-end)
- onpace = projected end-of-month total ≥ monthly target (and not tail-end / not complete)
- complete = monthly actual ≥ monthly target
- nodata = no monthly target or no actual data yet
- tail-end = target ≤ 3 (or BTS_Total ≤ 10) — surfaced as its own tile`;

type DashboardData = {
  raw: any;
  fetchedAt: number;
  source: string;
};

let _dataCache: DashboardData | null = null;

function originFromRequest(req: Request): string | null {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}`;
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function loadDashboardData(req: Request): Promise<DashboardData | null> {
  const now = Date.now();
  if (_dataCache && now - _dataCache.fetchedAt < DATA_CACHE_TTL_MS) {
    return _dataCache;
  }
  const candidates: string[] = [];
  if (process.env.URL) candidates.push(process.env.URL.replace(/\/$/, "") + "/data.json");
  if (process.env.DEPLOY_PRIME_URL) candidates.push(process.env.DEPLOY_PRIME_URL.replace(/\/$/, "") + "/data.json");
  const origin = originFromRequest(req);
  if (origin) candidates.push(origin.replace(/\/$/, "") + "/data.json");

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
      if (!resp.ok) continue;
      const json = await resp.json();
      _dataCache = { raw: json, fetchedAt: now, source: url };
      return _dataCache;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function fmtNum(v: any): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 100) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
}

function isTailEndSubject(s: any): boolean {
  const bts = Number(s?.BTS_Total);
  if (Number.isFinite(bts) && bts > 0 && bts <= TAIL_END_BTS_MAX) return true;
  // Earliest active month target as a proxy for monthly target
  const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
  for (const m of months) {
    const t = Number(s?.[m + "_Smoothed"]);
    if (Number.isFinite(t) && t > 0) {
      return t <= TAIL_END_TARGET_MAX;
    }
  }
  return false;
}

function buildDataPack(data: any, currentMonthLabel: string): string {
  if (!data) return "(dashboard data not available)";
  const lines: string[] = [];
  const fs = data.fetch_status || {};
  lines.push(
    "Data freshness: fetched " + (fs.fetched_at || "unknown") +
      "; last successful: " + (fs.last_successful_fetch || "unknown") +
      "; sources OK: " +
      Object.entries(fs.sources || {})
        .map(([k, v]) => `${k}=${v ? "ok" : "FAIL"}`)
        .join(", "),
  );
  lines.push("BTS months in scope: " + (data.bts_months || []).join(", "));

  const summary = data.summary || {};
  lines.push("");
  lines.push("PORTFOLIO SUMMARY:");
  lines.push("  total_subjects=" + summary.total_subjects);
  lines.push("  portfolio_bts_total=" + summary.portfolio_bts_total);
  lines.push("  portfolio_actual_to_date=" + summary.portfolio_actual_to_date +
    " (capped=" + summary.portfolio_actual_to_date_capped + ")");
  lines.push("  portfolio_remaining=" + summary.portfolio_remaining);
  lines.push("  months_completed=" + summary.months_completed +
    "; months_remaining=" + summary.months_remaining);
  lines.push("  unique_tutors_contracted=" + summary.unique_tutors_contracted);
  if (summary.action_counts) {
    lines.push("  action_counts: " + Object.entries(summary.action_counts)
      .map(([k, v]) => `${k}=${v}`).join("; "));
  }
  if (summary.tier_distribution) {
    lines.push("  tier_distribution: " + Object.entries(summary.tier_distribution)
      .map(([k, v]) => `${k}=${v}`).join("; "));
  }
  if (summary.march_baseline) {
    const mb = summary.march_baseline;
    lines.push("  march_baseline: actual=" + mb.total_actual + ", forecast=" + mb.total_forecast +
      ", variance=" + mb.variance + ", subjects_with_data=" + mb.subjects_with_data);
  }
  if (summary.last_updated) lines.push("  last_updated=" + summary.last_updated);

  const ws = data.weekly_summary || {};
  lines.push("");
  lines.push("WEEKLY SUMMARY (cached, see Subjects tab for live WBR):");
  lines.push("  generated_at=" + (ws.generated_at || ""));
  lines.push("  total_target=" + ws.total_target + "; total_actual=" + ws.total_actual + "; progress_pct=" + ws.progress_pct);
  lines.push("  on_pace_count=" + ws.on_pace_count + "; behind_pace_count=" + ws.behind_pace_count);
  lines.push("  high_priority_actions=" + ws.high_priority_actions + "; medium_priority_actions=" + ws.medium_priority_actions + "; total_actions=" + ws.total_actions);
  if (Array.isArray(ws.behind_pace_subjects) && ws.behind_pace_subjects.length) {
    lines.push("  behind_pace_subjects (cached top): " +
      ws.behind_pace_subjects.slice(0, 20)
        .map((b: any) => `${b.subject}@${b.pace}%`).join("; "));
  }
  if (Array.isArray(ws.biggest_gaps) && ws.biggest_gaps.length) {
    lines.push("  biggest_gaps (cached top): " +
      ws.biggest_gaps.slice(0, 10)
        .map((b: any) => `${b.subject}=-${b.remaining}`).join("; "));
  }

  // ──────────────────────────────────────────────────────────
  // SUBJECTS — one row per subject, all key Looker + forecast fields.
  // Header explains columns so the model can parse them deterministically.
  // ──────────────────────────────────────────────────────────
  const subjects: any[] = data.subjects || [];
  lines.push("");
  lines.push(`SUBJECTS (${subjects.length} total). One row per subject. Pipe-delimited.`);
  lines.push("Columns: Subject|Category|Tier|TailEnd|BTS_Total|RunRate|SmoothedTarget|MaxCapacity|GapPct|RawGap|CoveragePct|UtilRate|UtilCurrent|UtilTrailing|UtilTrend|UtilTrendDelta|TutorHoursUtilPct|P90_NAT_Hours|P90_Goal|AutoAssignable|OppsResponded|Assigns|Primary_Action|Problem_Type|Stress_Flags|Apr_Tgt|Apr_Act|May_Tgt|Jun_Tgt|Jul_Tgt|Aug_Tgt|Sep_Tgt|Oct_Tgt|Mar_Actual|Mar_Forecast|IsAdjusted|AdjustedMonths");
  for (const s of subjects) {
    const tail = isTailEndSubject(s) ? "Y" : "";
    const stress = Array.isArray(s.Stress_Flags) ? s.Stress_Flags.join(",") : "";
    const adjMonths = Array.isArray(s.Adjusted_Months) ? s.Adjusted_Months.join(",") : "";
    lines.push([
      s.Subject || "",
      s.Category || "",
      s.Tier || "",
      tail,
      fmtNum(s.BTS_Total),
      fmtNum(s.Run_Rate),
      fmtNum(s.Smoothed_Target),
      fmtNum(s.Max_Capacity),
      fmtNum(s.Gap_Pct),
      fmtNum(s.Raw_Gap),
      fmtNum(s.Coverage_Pct),
      fmtNum(s.Util_Rate),
      fmtNum(s.Util_Rate_Current),
      fmtNum(s.Util_Rate_Trailing),
      s.Util_Trend || "",
      fmtNum(s.Util_Trend_Delta),
      fmtNum(s.Tutor_Hours_Util_Pct),
      fmtNum(s.P90_NAT_Hours),
      fmtNum(s.P90_Goal),
      fmtNum(s.Auto_Assignable),
      fmtNum(s.Opps_Responded),
      fmtNum(s.Assigns),
      s.Primary_Action || "",
      s.Problem_Type || "",
      stress,
      fmtNum(s.Apr_Smoothed),
      // We surface Apr actual via monthly_tracker below — leave blank here unless present
      "",
      fmtNum(s.May_Smoothed),
      fmtNum(s.Jun_Smoothed),
      fmtNum(s.Jul_Smoothed),
      fmtNum(s.Aug_Smoothed),
      fmtNum(s.Sep_Smoothed),
      fmtNum(s.Oct_Smoothed),
      fmtNum(s.Mar_Actual),
      fmtNum(s.Mar_Forecast),
      s.Is_Adjusted ? "Y" : "",
      adjMonths,
    ].join("|"));
  }

  // ──────────────────────────────────────────────────────────
  // MONTHLY TRACKER — actuals + targets per subject per month
  // ──────────────────────────────────────────────────────────
  const tracker: any[] = data.monthly_tracker || [];
  lines.push("");
  lines.push(`MONTHLY TRACKER (${tracker.length} subjects). One row per subject with per-month progress.`);
  lines.push("Format: Subject || Month=actual/target(status) ; ...");
  for (const t of tracker) {
    const months = (t.months || []).map((m: any) => {
      const act = m.actual == null ? "-" : fmtNum(m.actual);
      const tgt = fmtNum(m.adjusted_target ?? m.smoothed_target);
      const status = m.status ? `,${m.status}` : "";
      return `${m.label}=${act}/${tgt}${status}`;
    }).join(" ; ");
    lines.push(`${t.subject} || ${months}`);
  }

  // ──────────────────────────────────────────────────────────
  // RECOMMENDATIONS
  // ──────────────────────────────────────────────────────────
  const recs: any[] = data.recommendations || [];
  if (recs.length) {
    lines.push("");
    lines.push(`RECOMMENDATIONS (${recs.length} total). One per row.`);
    lines.push("Format: [priority] subject (category) — action_type — reason");
    for (const r of recs) {
      lines.push(`[${r.priority || "?"}] ${r.subject || "?"} (${r.category || "?"}) — ${r.action_type || "?"} — ${r.reason || ""}`);
    }
  }

  // Append month-of-year context so the model can compute pace correctly
  lines.push("");
  lines.push("Active month label (for monthly pace math): " + currentMonthLabel);

  return lines.join("\n");
}

function currentMonthLabelUTC(): string {
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const d = new Date();
  return monthNames[d.getMonth()] + " " + d.getFullYear();
}

function getUserFromToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.split(" ")[1];
    const payload = JSON.parse(atob(token.split(".")[1]));
    return {
      email: payload.email || "",
      name:
        payload.user_metadata?.full_name ||
        payload.email?.split("@")[0] ||
        "Unknown",
    };
  } catch {
    return null;
  }
}

function getDevUserIfAllowed() {
  if (process.env.NETLIFY_DEV === "true") {
    return { email: "local@test", name: "Local Test" };
  }
  return null;
}

function parseAdminEmails(raw: string | undefined): string[] {
  const envEmails = (raw || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const defaults = DEFAULT_ADMIN_EMAILS.map((v) => v.toLowerCase());
  return Array.from(new Set([...defaults, ...envEmails]));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = (m as any).role;
    const content = (m as any).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    // Cap individual message size so a runaway client can't push 1MB messages.
    out.push({ role, content: trimmed.slice(0, 8000) });
  }
  // Anthropic requires the conversation to start with a user message.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204 });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const user = getUserFromToken(req) || getDevUserIfAllowed();
  if (!user) {
    return json({ error: "Authentication required" }, 401);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(
      {
        error:
          "ANTHROPIC_API_KEY is not set on this Netlify environment. Set it under Site settings → Environment variables and redeploy.",
        code: "missing_api_key",
      },
      503,
    );
  }

  // Reserved for future per-user gating. For now any signed-in user can chat.
  parseAdminEmails(process.env.ADMIN_EMAILS);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages.length) {
    return json({ error: "messages must include at least one user message" }, 400);
  }
  // Hard cap conversation length so a long session doesn't run up costs.
  const conversation = messages.slice(-30);

  const model =
    typeof body?.model === "string" && body.model
      ? body.model
      : process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const maxTokens = (() => {
    const fromBody = Number(body?.maxTokens);
    if (Number.isFinite(fromBody) && fromBody > 0) return Math.min(fromBody, 4096);
    const fromEnv = Number(process.env.ANTHROPIC_MAX_TOKENS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(fromEnv, 4096);
    return DEFAULT_MAX_TOKENS;
  })();

  // Pull the live dataset (cached per-instance for DATA_CACHE_TTL_MS).
  const dataPackEnabled = (process.env.CHAT_DISABLE_DATA_PACK || "").toLowerCase() !== "true";
  let dataPack: string | null = null;
  let dataSource: string | null = null;
  if (dataPackEnabled) {
    try {
      const dash = await loadDashboardData(req);
      if (dash) {
        dataPack = buildDataPack(dash.raw, currentMonthLabelUTC());
        dataSource = dash.source;
      }
    } catch (err) {
      // Don't fail the chat if data fetch hiccups — fall back to context-only mode.
      dataPack = null;
    }
  }

  const systemParts: string[] = [BASE_SYSTEM_PROMPT];
  if (dataPack) {
    systemParts.push(
      "<DATA_PACK source=\"" + (dataSource || "live") + "\">\n" +
        dataPack +
        "\n</DATA_PACK>",
    );
  } else {
    systemParts.push(
      "<DATA_PACK>(unavailable — answer from CURRENT_VIEW + your general dashboard knowledge; tell the operator the live dataset wasn't reachable so numbers may be stale.)</DATA_PACK>",
    );
  }
  if (typeof body?.systemPrompt === "string" && body.systemPrompt.trim()) {
    systemParts.push(body.systemPrompt.trim().slice(0, 4000));
  }
  if (typeof body?.contextSnapshot === "string" && body.contextSnapshot.trim()) {
    systemParts.push(
      "<CURRENT_VIEW>\n" + body.contextSnapshot.trim().slice(0, 12000) + "\n</CURRENT_VIEW>",
    );
  }
  systemParts.push(`Signed-in user: ${user.name} <${user.email}>.`);
  const systemPrompt = systemParts.join("\n\n");

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: conversation,
      }),
    });
  } catch (err: any) {
    return json(
      { error: "Failed to reach Anthropic: " + (err?.message || "unknown") },
      502,
    );
  }

  if (!anthropicResp.ok) {
    let detail: any = null;
    try {
      detail = await anthropicResp.json();
    } catch {
      // ignore
    }
    return json(
      {
        error:
          detail?.error?.message ||
          `Anthropic request failed (${anthropicResp.status})`,
        status: anthropicResp.status,
      },
      anthropicResp.status === 401 ? 401 : 502,
    );
  }

  const data = await anthropicResp.json();
  // Anthropic returns content as an array of blocks; we only handle text blocks.
  const reply = Array.isArray(data?.content)
    ? data.content
        .filter((c: any) => c?.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text)
        .join("\n\n")
        .trim()
    : "";

  return json({
    reply: reply || "(no response)",
    model: data?.model || model,
    usage: data?.usage || null,
    stopReason: data?.stop_reason || null,
  });
};

export const config = {
  path: "/api/chat",
};
