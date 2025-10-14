// Cloudflare Worker: RoundScript API proxy for Google Fact Check Tools
// Exposes: GET /api/search?q=...&lang=...
// Uses a secret FACTCHECK_API_KEY stored via `wrangler secret put FACTCHECK_API_KEY`

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === "/api/search" && request.method === "GET") {
        const q = url.searchParams.get("q") || "";
        const lang = url.searchParams.get("lang") || "en";
        if (!q) return json({ error: "Missing q" }, 400);

        const apiKey = env.FACTCHECK_API_KEY;
        if (!apiKey) return json({ error: "Missing FACTCHECK_API_KEY" }, 500);

        const gUrl = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
        gUrl.searchParams.set("query", q);
        //if (lang) gUrl.searchParams.set("languageCode", lang);
				if (lang && lang !== "auto") {
				  gUrl.searchParams.set("languageCode", lang);
				}
				gUrl.searchParams.set("pageSize", "10");
        gUrl.searchParams.set("key", apiKey);

        const gRes = await fetch(gUrl.toString(), { headers: { "Accept": "application/json" } });
        if (!gRes.ok) {
          const text = await gRes.text();
          return json({ error: "Upstream error", status: gRes.status, body: text }, gRes.status);
        }
        const raw = await gRes.json();
        const simplified = normalizeResults(q, raw);
        return json(simplified, 200);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

// Convert Google response into a compact, UI-friendly shape
function normalizeResults(query, raw) {
  const out = { query, results: [] };
  const claims = raw?.claims || [];
  for (const c of claims) {
    const reviews = c.claimReview || [];
    // Prefer the first review
    const r = reviews[0] || {};
    out.results.push({
      text: c.text || "",
      claimant: c.claimant || "",
      claimDate: c.claimDate || "",
      reviewPublisher: r.publisher?.name || "",
      reviewUrl: r.url || "",
      rating: r.textualRating || "",
      title: r.title || r.url || ""
    });
  }
  return out;
}
