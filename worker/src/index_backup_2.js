// RoundScript Worker with Global FactCheck proxy and Nigeria direct sources
// Endpoints:
//   GET /api/search?q=...&lang=...          -> Google Fact Check Tools API (normalized)
//   GET /api/ng-search?q=...                -> Crawls Nigeria-focused fact-check sites (ClaimReview-first)
//
// Secret required: FACTCHECK_API_KEY

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cleanPath = path.replace(/\/+$/, "");

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (cleanPath === "/") {
        return new Response("RoundScript API is running. Try /api/search?q=example&lang=en or /api/ng-search?q=example", {
          headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders() }
        });
      }

      if (cleanPath === "/api/search" && request.method === "GET") {
        const q = url.searchParams.get("q") || "";
        const lang = url.searchParams.get("lang") || "en";
        if (!q) return json({ error: "Missing q" }, 400);

        const apiKey = env.FACTCHECK_API_KEY;
        if (!apiKey) return json({ error: "Missing FACTCHECK_API_KEY" }, 500);

        const gUrl = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
        gUrl.searchParams.set("query", q);
        if (lang && lang !== "auto") gUrl.searchParams.set("languageCode", lang);
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

      if (cleanPath === "/api/ng-search" && request.method === "GET") {
        const q = url.searchParams.get("q") || "";
        const results = await searchNigeriaClaims();
        const filtered = q ? results.filter(r => 
          ((r.title||"").toLowerCase().includes(q.toLowerCase())) ||
          ((r.text||"").toLowerCase().includes(q.toLowerCase()))
        ) : results;
        return json({ query: q, results: filtered }, 200);
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
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}

function normalizeResults(query, raw) {
  const out = { query, results: [] };
  const claims = raw?.claims || [];
  for (const c of claims) {
    const reviews = c.claimReview || [];
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

// ---- Nigeria sources ----

async function fetchText(url) {
  const r = await fetch(url, { headers: { "Accept": "text/html,application/xhtml+xml" }});
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return await r.text();
}

function extractJsonLdClaimReview(html, baseUrl) {
  const out = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRegex.exec(html)) !== null) {
    const block = m[1]?.trim();
    if (!block) continue;
    try {
      const parsed = JSON.parse(block);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        const graphs = node?.["@graph"] ? node["@graph"] : [node];
        for (const g of graphs) {
          const type = g?.["@type"];
          const isClaim = Array.isArray(type) ? type.includes("ClaimReview") : type === "ClaimReview";
          if (isClaim) {
            const item = g.itemReviewed || {};
            out.push({
              text: item.claimReviewed || item.name || "",
              claimant: item.author?.name || "",
              claimDate: item.datePublished || "",
              reviewPublisher: (g.author?.name || g.publisher?.name || ""),
              reviewUrl: g.url || baseUrl || "",
              rating: g.reviewRating?.alternateName || g.reviewRating?.name || "",
              title: g.headline || item.name || ""
            });
          }
        }
      }
    } catch (_) {}
  }
  return out;
}

async function crawlListing(listUrl, hrefRegex) {
  const html = await fetchText(listUrl);
  const links = new Set();
  const rx = hrefRegex || /href="(https?:\/\/[^"]+\/(?:\d{4}\/\d{2}\/\d{2}\/[^"]+|[^"]*fact[^"]+))"/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    try {
      const u = new URL(m[1]).toString();
      links.add(u);
    } catch {}
  }
  return [...links].slice(0, 12);
}

async function fetchClaimReviewsFromArticle(url) {
  const html = await fetchText(url);
  const claims = extractJsonLdClaimReview(html, url);
  if (claims.length) return claims.map(r => ({ ...r, reviewUrl: r.reviewUrl || url }));
  // Fallback: use <title> as headline
  const title = (html.match(/<title>(.*?)<\/title>/i)?.[1] || "").replace(/\s+\|.*/,"").trim();
  return [{ title, text: "", claimant: "", claimDate: "", reviewPublisher: (new URL(url)).hostname, reviewUrl: url, rating: "" }];
}

async function searchNigeriaClaims() {
  const seeds = [
    "https://dubawa.org/category/fact-check/",
    "https://africacheck.org/fact-checks",
    "https://factcheck.afp.com/AFP-Nigeria",
    "https://factcheck.thecable.ng/",
    "https://www.premiumtimesng.com/category/news/fact-checks",
    "https://factcheckhub.com/"
  ];
  const collected = [];
  for (const listUrl of seeds) {
    try {
      const links = await crawlListing(listUrl);
      for (const u of links) {
        try {
          const items = await fetchClaimReviewsFromArticle(u);
          for (const it of items) collected.push(it);
        } catch {}
      }
    } catch {}
  }
  // Dedup by reviewUrl/title
  const seen = new Set();
  const unique = collected.filter(r => {
    const key = (r.reviewUrl || r.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique;
}
