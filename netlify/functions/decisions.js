const { getStore } = require("@netlify/blobs");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Content-Type": "application/json",
  };
}

function getUserFromToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.split(" ")[1];
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return {
      email: payload.email || "",
      name: payload.user_metadata?.full_name || payload.email?.split("@")[0] || "Unknown",
    };
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }

  const user = getUserFromToken(event);
  if (!user) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Authentication required" }),
    };
  }

  const store = getStore("decisions");

  if (event.httpMethod === "GET") {
    try {
      const blob = await store.get("all_decisions");
      const decisions = blob ? JSON.parse(blob) : {};
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify(decisions),
      };
    } catch {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({}),
      };
    }
  }

  if (event.httpMethod === "POST") {
    try {
      const incoming = JSON.parse(event.body);
      const { key, decision } = incoming;
      if (!key || !decision) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "key and decision are required" }),
        };
      }

      const blob = await store.get("all_decisions");
      const decisions = blob ? JSON.parse(blob) : {};
      decisions[key] = decision;
      await store.set("all_decisions", JSON.stringify(decisions));

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: true, total: Object.keys(decisions).length }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  if (event.httpMethod === "DELETE") {
    try {
      const incoming = JSON.parse(event.body);
      const { key } = incoming;
      if (!key) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "key is required" }),
        };
      }

      const blob = await store.get("all_decisions");
      const decisions = blob ? JSON.parse(blob) : {};
      delete decisions[key];
      await store.set("all_decisions", JSON.stringify(decisions));

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: true }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: corsHeaders(),
    body: JSON.stringify({ error: "Method not allowed" }),
  };
};
