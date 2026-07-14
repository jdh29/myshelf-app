// Cloudflare Pages Function: GET /api/load?syncCode=theircode
// Loads the user's book list from KV by their sync code.

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.APPS_KV) {
    return json({ error: "Sync store not configured" }, 500);
  }

  const url = new URL(request.url);
  const syncCode = (url.searchParams.get("syncCode") || "").trim().toLowerCase();
  if (!syncCode || syncCode.length < 4) {
    return json({ error: "Sync code must be at least 4 characters" }, 400);
  }

  const key = `myshelf:${syncCode}`;

  try {
    const stored = await env.APPS_KV.get(key);
    if (!stored) {
      // No data yet for this code — return an empty shelf, not an error.
      return json({ books: [], updatedAt: null }, 200);
    }
    const parsed = JSON.parse(stored);
    return json({
      books: Array.isArray(parsed.books) ? parsed.books : [],
      updatedAt: parsed.updatedAt || null,
    }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
