import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204 });
  }

  const user = getUserFromToken(req);
  if (!user) {
    return json({ error: "Authentication required" }, 401);
  }

  const store = getStore("decisions");

  if (req.method === "GET") {
    try {
      const blob = await store.get("all_decisions");
      const decisions = blob ? JSON.parse(blob) : {};
      return json(decisions);
    } catch {
      return json({});
    }
  }

  if (req.method === "POST") {
    try {
      const { key, decision } = await req.json();
      if (!key || !decision) {
        return json({ error: "key and decision are required" }, 400);
      }

      const blob = await store.get("all_decisions");
      const decisions = blob ? JSON.parse(blob) : {};
      decisions[key] = decision;
      await store.set("all_decisions", JSON.stringify(decisions));

      return json({ ok: true, total: Object.keys(decisions).length });
    } catch (err: any) {
      return json({ error: err.message }, 500);
    }
  }

  if (req.method === "DELETE") {
    try {
      const { key } = await req.json();
      if (!key) {
        return json({ error: "key is required" }, 400);
      }

      const blob = await store.get("all_decisions");
      const decisions = blob ? JSON.parse(blob) : {};
      delete decisions[key];
      await store.set("all_decisions", JSON.stringify(decisions));

      return json({ ok: true });
    } catch (err: any) {
      return json({ error: err.message }, 500);
    }
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/decisions",
};
