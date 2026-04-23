import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

type RoadmapStatus = "Not Started" | "In Progress" | "Shipped";
type SuggestionStatus = "New" | "Accepted" | "Declined" | "Duplicate";

type RoadmapItem = {
  id: string;
  title: string;
  category: string;
  description: string;
  priority?: string;
  status: RoadmapStatus;
  eta?: string | null;
  created_at: string;
  started_at?: string;
  updated_at?: string;
  shipped_at?: string;
};

type RoadmapSuggestion = {
  id: string;
  submitter_email: string;
  submitted_at: string;
  text: string;
  status: SuggestionStatus;
  linked_item_id?: string;
};

const DEFAULT_ADMIN_EMAILS = ["leigh.robbins@varsitytutors.com"];

const ROADMAP_SEED_DATA: Array<Omit<RoadmapItem, "created_at">> = [
  {
    id: "overview-labels",
    title: "Add 'Subjects' to Overview tile labels",
    category: "Labels & Clarity",
    description:
      "Every count tile on the Overview (and BTS) tab will explicitly include the word 'Subjects' in its label so external viewers don't mistake subject counts for tutor counts.",
    priority: "P0",
    status: "Shipped",
  },
  {
    id: "spell-out-thu",
    title: "Spell out 'THU' as 'Tutor Hours Utilization'",
    category: "Labels & Clarity",
    description:
      "Replace the THU abbreviation everywhere it appears with the full phrase so stakeholders don't have to guess what it means.",
    priority: "P0",
    status: "Shipped",
  },
  {
    id: "inline-p90-util",
    title: "Show P90 and Utilization values inline on Overview",
    category: "Labels & Clarity",
    description:
      "Where action text references high P90 or low utilization qualitatively, show the actual numeric value inline. Matches the format already used on other tabs.",
    priority: "P0",
    status: "Shipped",
  },
  {
    id: "clickable-subjects",
    title: "Make subjects clickable from Overview top-10 tables",
    category: "Navigation",
    description:
      "Clicking a subject name in an Overview top-10 table jumps the user to that subject in the Subjects & Actions tab with the filter pre-applied.",
    priority: "P0",
    status: "Shipped",
  },
  {
    id: "rename-wait-time",
    title: "Rename 'Wait Time' action label to 'High Wait Time'",
    category: "Labels & Clarity",
    description:
      "Single-word 'Wait Time' is ambiguous. Relabel and verify BTS actions and monthly actions don't share the same label if signals differ.",
    priority: "P0",
    status: "Shipped",
  },
  {
    id: "complete-subjects-tile",
    title: "Add 'Complete Subjects' tile",
    category: "Overview Tiles",
    description:
      "Separate subjects that have hit their target from subjects that are merely on pace. A subject with target 2 and 2 contracted is complete, not in progress.",
    priority: "P1",
    status: "Shipped",
  },
  {
    id: "tail-end-subjects",
    title: "Add 'Tail-End Subjects' bucket (foundational)",
    category: "Overview Tiles",
    description:
      "New classification for subjects with target ≤ 3 (tunable constant). Tail-end subjects are excluded from Behind Pace and Reduce Forecast counts so those tiles stop being inflated by low-target subjects, while niche priorities like LSAT remain visible and tracked.",
    priority: "P1",
    status: "In Progress",
  },
  {
    id: "exclude-tail-from-counts",
    title: "Exclude Tail-End subjects from Behind Pace / Reduce Forecast",
    category: "Overview Tiles",
    description:
      "Apply the Tail-End classification precedence so every subject lands in exactly one tile and the headline counts become trustworthy.",
    priority: "P1",
    status: "Not Started",
  },
  {
    id: "reduce-forecast-filter-fix",
    title: "Fix default filters on 'Reduce Forecast' tile click",
    category: "Overview Tiles",
    description:
      "Clicking the Reduce Forecast tile currently auto-applies Behind Pace and Hide Niche filters, causing the drilled-in count to mismatch the tile headline. Show all items in the tile's classification by default.",
    priority: "P1",
    status: "Not Started",
  },
  {
    id: "data-review-tile",
    title:
      "Consolidate 'Awaiting Data' and 'Insufficient Data' into 'Data Review Needed'",
    category: "Overview Tiles",
    description:
      "Replace the two overlapping tiles with a single 'Data Review Needed' tile that surfaces the reason (naming mismatch vs. early-month / no activity yet) as a sub-label on each row.",
    priority: "P1",
    status: "Not Started",
  },
  {
    id: "action-entry-form",
    title: "Action entry: description + estimated completion date",
    category: "Action Tracking",
    description:
      "When a user clicks Action on a subject, show a form capturing description, estimated completion date, and owner. Required to make actions trackable.",
    priority: "P2",
    status: "Not Started",
  },
  {
    id: "action-status-logic",
    title: "Action status: In Progress / Overdue / Complete",
    category: "Action Tracking",
    description:
      "Decision History shows a status per action, auto-computed from today's date vs. estimated completion date, with a manual Mark Complete checkbox.",
    priority: "P2",
    status: "Not Started",
  },
  {
    id: "action-reschedule",
    title: "Reschedule actions with audit log",
    category: "Action Tracking",
    description:
      "Push out an action's due date with a required reason. Every push is recorded in an expandable audit log on the action row.",
    priority: "P2",
    status: "Not Started",
  },
  {
    id: "action-effectiveness",
    title: "Action effectiveness retrospective",
    category: "Action Tracking",
    description:
      "When an action is marked complete, snapshot the subject's metrics. Two weeks later, compare to snapshot and label the action Helped / Neutral / Did Not Help. Design with Darren before building.",
    priority: "P2",
    status: "Not Started",
  },
  {
    id: "slack-digest",
    title: "Slack daily digest for actions",
    category: "Integrations",
    description:
      "Once-daily 8 AM CT DM to each action owner summarizing upcoming and overdue actions, with links back into the dashboard. Avoids the spam of per-action notifications.",
    priority: "P3",
    status: "Not Started",
  },
  {
    id: "admin-target-override",
    title: "Admin section for target overrides",
    category: "Admin & Access",
    description:
      "Leigh and Darren can pick a subject and month and update the target in-dashboard, with an audit history shown below.",
    priority: "P3",
    status: "Not Started",
  },
  {
    id: "ai-assistant",
    title: "AI assistant chat bubble (Anthropic API)",
    category: "AI Features",
    description:
      "Floating, draggable chat bubble powered by the Anthropic API directly, with the user's current dashboard context injected into the system prompt. Matches the pattern that worked on the VCPU dashboard — far richer responses than Cursor's built-in assistant.",
    priority: "P3",
    status: "Not Started",
  },
  {
    id: "p90-tier-review",
    title: "Review P90 time-to-assign tier goals",
    category: "Forecasting Logic",
    description:
      "Revisit the current tier goals (Core 24h, High 36h, Medium 48h, Low 60h, Niche 72h). Pull 3 months of P90 distributions by tier, compute the 80th percentile, and compare to the current goals. Update constants once data-backed thresholds are confirmed.",
    priority: "P1",
    status: "Not Started",
  },
  {
    id: "ingest-looker-additional",
    title:
      "Ingest additional Looker signals (Michael's client-side looks, utilization dashboard)",
    category: "Forecasting Logic",
    description:
      "Pull more signals into the classification engine so actions incorporate client-side context (e.g., oversupplied but fine because a known event is upcoming in month X).",
    priority: "P4",
    status: "Not Started",
  },
  {
    id: "prophet-prototype",
    title: "Prototype Prophet-style forecasting inside the dashboard",
    category: "Forecasting Logic",
    description:
      "Study Meta Prophet's internals and prototype a minimal forecast for a handful of subjects inside the dashboard, to compare against Pierre's V1.4 model.",
    priority: "P4",
    status: "Not Started",
  },
  {
    id: "sat-indeed-retro",
    title: "SAT / Indeed recruiting retrospective",
    category: "Analysis (separate deliverable)",
    description:
      "Before/after comparison of SAT run rate when Indeed was active vs. paused. Output: list of subjects where sustained recruiting spend is always justified. Not part of the dashboard itself.",
    priority: "P4",
    status: "Not Started",
  },
  {
    id: "sort-sweep",
    title: "Cross-tab sortability sweep",
    category: "Navigation",
    description:
      "Verify every table on every tab supports sort-by-column-header. Season Gap sort confirmed in meeting; quick sweep for consistency.",
    priority: "P4",
    status: "Not Started",
  },
];

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
    return {
      email: "local@test",
      name: "Local Test",
    };
  }
  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseAdminEmails(raw: string | undefined): string[] {
  const envEmails = (raw || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const defaults = DEFAULT_ADMIN_EMAILS.map((v) => v.toLowerCase());
  return Array.from(new Set([...defaults, ...envEmails]));
}

function isAdmin(email: string, adminEmails: string[]) {
  return !!email && adminEmails.includes(email.toLowerCase());
}

function normalizeRoadmapStatus(status: string): RoadmapStatus {
  if (status === "Not Started") return "Not Started";
  if (status === "In Progress") return "In Progress";
  if (status === "Shipped") return "Shipped";
  return "Not Started";
}

function roadmapStatusRank(status: RoadmapStatus): number {
  if (status === "Not Started") return 0;
  if (status === "In Progress") return 1;
  if (status === "Shipped") return 2;
  return 0;
}

function normalizeSuggestionStatus(status: string): SuggestionStatus {
  if (status === "New") return "New";
  if (status === "Accepted") return "Accepted";
  if (status === "Declined") return "Declined";
  if (status === "Duplicate") return "Duplicate";
  return "New";
}

function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${random}`;
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204 });
  }

  const user = getUserFromToken(req) || getDevUserIfAllowed();
  if (!user) {
    return json({ error: "Authentication required" }, 401);
  }

  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  const userIsAdmin = isAdmin(user.email, adminEmails);
  const nowIso = new Date().toISOString();

  const roadmapStore = getStore("roadmap-items");
  const suggestionsStore = getStore("roadmap-suggestions");

  async function loadItems(): Promise<RoadmapItem[]> {
    const blob = await roadmapStore.get("all_items");
    let items: RoadmapItem[] = blob ? JSON.parse(blob) : [];
    if (!Array.isArray(items)) items = [];

    const byId = new Map<string, RoadmapItem>();
    items.forEach((item) => {
      if (item && item.id) byId.set(item.id, item);
    });

    let changed = items.length === 0;
    ROADMAP_SEED_DATA.forEach((seed) => {
      const seedStatus = normalizeRoadmapStatus(seed.status);
      if (byId.has(seed.id)) {
        const existing = byId.get(seed.id)!;
        const currentStatus = normalizeRoadmapStatus(existing.status);
        if (roadmapStatusRank(seedStatus) > roadmapStatusRank(currentStatus)) {
          existing.status = seedStatus;
          existing.updated_at = nowIso;
          if (seedStatus === "In Progress" && !existing.started_at) {
            existing.started_at = nowIso;
          }
          if (seedStatus === "Shipped" && !existing.shipped_at) {
            existing.shipped_at = nowIso;
          }
          changed = true;
        } else if (currentStatus === "Shipped" && !existing.shipped_at) {
          existing.shipped_at = nowIso;
          existing.updated_at = nowIso;
          changed = true;
        }
        return;
      }
      const seededItem: RoadmapItem = {
        ...seed,
        status: seedStatus,
        created_at: nowIso,
      };
      if (seedStatus === "In Progress") seededItem.started_at = nowIso;
      if (seedStatus === "Shipped") seededItem.shipped_at = nowIso;
      byId.set(seed.id, seededItem);
      changed = true;
    });

    items = Array.from(byId.values());
    if (changed) {
      await roadmapStore.set("all_items", JSON.stringify(items));
    }
    return items;
  }

  async function saveItems(items: RoadmapItem[]) {
    await roadmapStore.set("all_items", JSON.stringify(items));
  }

  async function loadSuggestions(): Promise<RoadmapSuggestion[]> {
    const blob = await suggestionsStore.get("all_suggestions");
    const suggestions = blob ? JSON.parse(blob) : [];
    if (!Array.isArray(suggestions)) return [];
    return suggestions;
  }

  async function saveSuggestions(suggestions: RoadmapSuggestion[]) {
    await suggestionsStore.set("all_suggestions", JSON.stringify(suggestions));
  }

  if (req.method === "GET") {
    try {
      const [items, suggestions] = await Promise.all([
        loadItems(),
        loadSuggestions(),
      ]);
      return json({
        items,
        suggestions,
        isAdmin: userIsAdmin,
      });
    } catch (err: any) {
      return json({ error: err.message || "Failed to load roadmap data" }, 500);
    }
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const op = body?.op;
    if (!op) return json({ error: "op is required" }, 400);

    if (op === "suggestion.create") {
      const text = (body?.text || "").trim();
      if (!text) return json({ error: "text is required" }, 400);
      const suggestions = await loadSuggestions();
      suggestions.push({
        id: makeId("sugg"),
        submitter_email: user.email,
        submitted_at: nowIso,
        text,
        status: "New",
      });
      await saveSuggestions(suggestions);
      const items = await loadItems();
      return json({ ok: true, items, suggestions, isAdmin: userIsAdmin });
    }

    if (!userIsAdmin) {
      return json({ error: "Admin permissions required" }, 403);
    }

    if (op === "item.updateStatus") {
      const id = body?.id;
      const status = normalizeRoadmapStatus(body?.status || "");
      if (!id) return json({ error: "id is required" }, 400);

      const items = await loadItems();
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) return json({ error: "Roadmap item not found" }, 404);

      const updated = {
        ...items[idx],
        status,
        updated_at: nowIso,
      };
      if (status === "In Progress" && !updated.started_at) {
        updated.started_at = nowIso;
      }
      if (status === "Shipped") {
        updated.shipped_at = nowIso;
      }
      items[idx] = updated;
      await saveItems(items);

      const suggestions = await loadSuggestions();
      return json({ ok: true, items, suggestions, isAdmin: userIsAdmin });
    }

    if (op === "suggestion.updateStatus") {
      const id = body?.id;
      const status = normalizeSuggestionStatus(body?.status || "");
      if (!id) return json({ error: "id is required" }, 400);

      const suggestions = await loadSuggestions();
      const idx = suggestions.findIndex((item) => item.id === id);
      if (idx < 0) return json({ error: "Suggestion not found" }, 404);

      suggestions[idx] = {
        ...suggestions[idx],
        status,
      };
      await saveSuggestions(suggestions);
      const items = await loadItems();
      return json({ ok: true, items, suggestions, isAdmin: userIsAdmin });
    }

    if (op === "suggestion.promote") {
      const suggestionId = body?.id;
      if (!suggestionId) return json({ error: "id is required" }, 400);

      const suggestions = await loadSuggestions();
      const suggestion = suggestions.find((s) => s.id === suggestionId);
      if (!suggestion) return json({ error: "Suggestion not found" }, 404);

      const items = await loadItems();
      const cleanText = suggestion.text.trim();
      const titleBase = cleanText.split("\n")[0].trim();
      const title = titleBase.length > 80 ? `${titleBase.slice(0, 77)}...` : titleBase;

      const newItem: RoadmapItem = {
        id: makeId("roadmap"),
        title: title || "Promoted suggestion",
        category: "Suggested Updates",
        description: cleanText,
        priority: "P3",
        status: "Not Started",
        created_at: nowIso,
      };

      items.push(newItem);
      await saveItems(items);

      const idx = suggestions.findIndex((s) => s.id === suggestionId);
      suggestions[idx] = {
        ...suggestions[idx],
        status: "Accepted",
        linked_item_id: newItem.id,
      };
      await saveSuggestions(suggestions);

      return json({ ok: true, items, suggestions, isAdmin: userIsAdmin });
    }

    return json({ error: "Unsupported operation" }, 400);
  } catch (err: any) {
    return json({ error: err.message || "Roadmap operation failed" }, 500);
  }
};

export const config = {
  path: "/api/roadmap",
};
