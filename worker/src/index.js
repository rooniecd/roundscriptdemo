// RoundScript Worker — with Nigeria sources (/api/ng-search) + Google Fact Check (/api/search)
// Requires secret FACTCHECK_API_KEY
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const cleanPath = path.replace(/\/+$/, "");

    try {
      if (cleanPath === "/") {
        return new Response("RoundScript API running. Try /api/search?q=example&lang=en or /api/ng-search?q=example", {
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
        return json(normalizeGoogleResults(q, raw), 200);
      }

      if (cleanPath === "/api/ng-search" && request.method === "GET") {
        const q = url.searchParams.get("q") || "";
        const results = await searchNigeriaClaims(q);
        return json({ query: q, results }, 200);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err?.message || String(err) }, 500);
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

// ============== Google normalize ==============
function normalizeGoogleResults(query, raw) {
  const out = { query, results: [] };
  const claims = raw?.claims || [];
  for (const c of claims) {
    const r = (c.claimReview || [])[0] || {};
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

// ============== Nigeria sources ==============
async function fetchText(url) {
  const r = await fetch(url, { headers: { "Accept": "text/html,application/xhtml+xml" }});
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return await r.text();
}

function extractJsonLdClaimReview(html) {
  const out = [];
  const reScripts = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = reScripts.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const json = JSON.parse(raw);
      const arr = Array.isArray(json) ? json : [json];
      for (const it of arr) {
        const graphs = it['@graph'] ? it['@graph'] : [it];
        for (const g of graphs) {
          const typ = g['@type'];
          const isClaim = (typ === 'ClaimReview') || (Array.isArray(typ) && typ.includes('ClaimReview'));
          if (!isClaim) continue;
          const item = g.itemReviewed || {};
          out.push({
            text: item.claimReviewed || item.name || "",
            claimant: item.author?.name || "",
            claimDate: item.datePublished || "",
            reviewPublisher: (g.author?.name || g.publisher?.name || ""),
            reviewUrl: g.url || "",
            rating: g.reviewRating?.alternateName || g.reviewRating?.name || "",
            title: (g.headline || item.name || "")
          });
        }
      }
    } catch {}
  }
  return out;
}

async function crawlListing(listUrl, itemSelectorRegex) {
  const html = await fetchText(listUrl);
  const hrefs = new Set();
  const rx = itemSelectorRegex || /href="(https?:\/\/[^"]+\/(?:\d{4}\/\d{2}\/\d{2}\/[^"#]+|[^"#]*fact[^"#]+))"/gi;
  let m;
  while ((m = rx.exec(html)) !== null) hrefs.add(m[1]);
  return [...hrefs].slice(0, 12);
}

async function fetchClaimReviewsFromArticle(url) {
  const html = await fetchText(url);
  const claimreviews = extractJsonLdClaimReview(html);
  if (claimreviews.length) return claimreviews.map(r => ({ ...r, reviewUrl: r.reviewUrl || url }));
  // fallback: simple title extraction
  const tmatch = html.match(/<title>(.*?)<\/title>/i);
  const title = (tmatch ? tmatch[1] : "").replace(/\s+\|.*/,"").trim();
  return [{ title, text: "", claimant: "", claimDate: "", reviewPublisher: (new URL(url)).hostname, reviewUrl: url, rating: "" }];
}

async function crawlSiteSearch(baseUrl, q){
  const url = `${baseUrl.replace(/\/+$/,"")}/?s=${encodeURIComponent(q)}`;
  const html = await fetchText(url);
  const hrefs = new Set();
  const rx = /href="(https?:\/\/[^"]+\/\d{4}\/\d{2}\/\d{2}\/[^"#]+)"/gi;
  let m;
  while ((m = rx.exec(html)) !== null) hrefs.add(m[1]);
  return [...hrefs].slice(0, 10);
}

async function searchNigeriaClaims(query) {
  // domains (home) for site search
  const seeds = [
    "https://dubawa.org",
    "https://factcheckhub.com",
    "https://factcheck.thecable.ng",
    "https://www.premiumtimesng.com",
    "https://africacheck.org",
    "https://factcheck.afp.com/AFP-Nigeria"
  ];
  // listing pages with many fact-checks
  const listingSources = [
    "https://dubawa.org/category/fact-check/",
    "https://factcheckhub.com/",
    "https://factcheck.thecable.ng/",
    "https://www.premiumtimesng.com/category/news/fact-checks",
    "https://africacheck.org/fact-checks",
    "https://factcheck.afp.com/AFP-Nigeria"
  ];

  const collected = [];

  // 1) crawl known listings
  for (const listUrl of listingSources) {
    try {
      const links = await crawlListing(listUrl);
      for (const u of links) {
        try {
          const items = await fetchClaimReviewsFromArticle(u);
          collected.push(...items);
        } catch {}
      }
    } catch {}
  }

  // 2) site search by query to capture related articles
  if (query) {
    for (const base of seeds) {
      try {
        const links = await crawlSiteSearch(base, query);
        for (const u of links) {
          try {
            const items = await fetchClaimReviewsFromArticle(u);
            collected.push(...items);
          } catch {}
        }
      } catch {}
    }
  }

  // de-dup
  const seen = new Set();
  const unique = collected.filter(r => {
    const key = (r.reviewUrl || r.title || "") + "|" + (r.reviewPublisher || "");
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  // filter by query if provided
  const filtered = query ? unique.filter(r => {
    const q = query.toLowerCase();
    return (r.title||"").toLowerCase().includes(q) ||
           (r.text||"").toLowerCase().includes(q);
  }) : unique;

  return filtered;
}
