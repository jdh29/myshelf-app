// Cloudflare Pages Function: POST /api/save
// Saves the user's book list to KV under their sync code.
// Body: { syncCode: "theircode", books: [...] }

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.APPS_KV) {
    return json({ error: "Sync store not configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const syncCode = (body.syncCode || "").trim().toLowerCase();
  if (!syncCode || syncCode.length < 4) {
    return json({ error: "Sync code must be at least 4 characters" }, 400);
  }
  if (!Array.isArray(body.books)) {
    return json({ error: "Missing books array" }, 400);
  }

  // Key is prefixed per-app so one KV store can serve multiple apps.
  const key = `myshelf:${syncCode}`;

  try {
    const payload = JSON.stringify({
      books: body.books,
      updatedAt: new Date().toISOString(),
    });
    await env.APPS_KV.put(key, payload);
    return json({ ok: true, count: body.books.length }, 200);
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
