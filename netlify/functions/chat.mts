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

const BASE_SYSTEM_PROMPT = `You are the Dashboard Assistant for the BTS Tutor Supply Forecasting Dashboard.

Your job is to help operators understand:
- subject pacing (Behind / On Pace / Complete / Awaiting Data / Tail-End),
- recommended actions (Recruit, Investigate, High Wait Time, Reduce Forecast),
- the difference between BTS-season classifications and monthly classifications,
- weekly business review (WBR) numbers and how they're computed,
- which subjects to prioritize and why.

Style:
- Be concise. Default to short paragraphs and bulleted answers.
- Cite specific subject names and numbers from the provided dashboard context.
- If the user asks something the context doesn't answer, say so plainly and suggest where in the dashboard to look.
- Never invent subject names, counts, or trends. If you don't know, say "I don't have that in the current context."
- Prefer plain language over jargon. Spell out THU as "Tutor Hours Utilization" the first time you use it.

Tail-End rule (important):
- A subject with monthly target ≤ 3 (or BTS_Total ≤ 10) is a "Tail-End" subject and is excluded from headline counts like Behind Pace, On Pace, Awaiting Data, Investigate, and Reduce Forecast.
- The Recruit, On Track, High Wait Time, and Complete tiles still INCLUDE tail-end subjects (carve-outs).`;

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

  const systemParts: string[] = [BASE_SYSTEM_PROMPT];
  if (typeof body?.systemPrompt === "string" && body.systemPrompt.trim()) {
    systemParts.push(body.systemPrompt.trim().slice(0, 4000));
  }
  if (typeof body?.contextSnapshot === "string" && body.contextSnapshot.trim()) {
    systemParts.push(
      "Current dashboard context (auto-generated, may be partial):\n" +
        body.contextSnapshot.trim().slice(0, 12000),
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
