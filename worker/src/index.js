export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cleanPath = path.replace(/\/+$/, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (cleanPath === "/") {
        return new Response("RoundScript API is running. Try /api/search?q=example&lang=en or /api/ng-search?q=asuu", {
          headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders() }
        });
      }

      if (cleanPath === "/api/search" && request.method === "GET") {
        return handleGlobalSearch(url, env);
      }

      if (cleanPath === "/api/ng-search" && request.method === "GET") {
        return handleNigeriaSearch(url);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  }
};

async function handleGlobalSearch(url, env) {
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

async function handleNigeriaSearch(url) {
  const q = url.searchParams.get("q") || "";
  const items = await searchNigeriaClaims(q);
  return json({ query: q, results: items }, 200);
}

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

/* ============== Nigeria helpers ============== */

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en",
      "User-Agent": "RoundScriptBot/1.0 (+Cloudflare Workers)"
    }
  });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return await r.text();
}

function extractLinks(html, hostFilter) {
  const hrefs = new Set();
  const rx = /href="(https?:\/\/[^"#\s]+)"/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const u = m[1];
    if (/(\.jpg|\.jpeg|\.png|\.gif|#|\/wp-json|\/feed)/i.test(u)) continue;
    if (hostFilter && !u.includes(hostFilter)) continue;
    hrefs.add(u);
  }
  return [...hrefs];
}

async function crawlListing(listUrl, hostFilter) {
  const html = await fetchText(listUrl);
  const links = extractLinks(html, hostFilter);
  return links.filter(u =>
    /fact-?check|verify|debunk|asuu|education/i.test(u)
  ).slice(0, 25);
}

async function crawlSiteSearch(baseUrl, q, hostFilter) {
  const url = `${baseUrl.replace(/\/$/,'')}/?s=${encodeURIComponent(q)}`;
  const html = await fetchText(url);
  const links = extractLinks(html, hostFilter);
  return links.filter(u =>
    /fact-?check|verify|debunk|asuu/i.test(u)
  ).slice(0, 25);
}

function extractJsonLdClaimReview(html) {
  const out = [];
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    try {
      const json = JSON.parse(m[1].trim());
      const items = Array.isArray(json) ? json : [json];
      for (const it of items) {
        const graphs = it['@graph'] ? it['@graph'] : [it];
        for (const g of graphs) {
          const type = g['@type'];
          const isCR = (type === 'ClaimReview') || (Array.isArray(type) && type.includes('ClaimReview'));
          if (isCR) {
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
      }
    } catch(_) {}
  }
  return out;
}

async function fetchClaimReviewsFromArticle(url) {
  const html = await fetchText(url);
  const claimreviews = extractJsonLdClaimReview(html);
  if (claimreviews.length) {
    return claimreviews.map(r => ({ ...r, reviewUrl: r.reviewUrl || url }));
  }
  const title = (html.match(/<title>(.*?)<\/title>/i)?.[1] || "").replace(/\s+\|.*/,"").trim();
  return [{
    title: title || url,
    text: "",
    claimant: "",
    claimDate: "",
    reviewPublisher: (new URL(url)).hostname,
    reviewUrl: url,
    rating: ""
  }];
}

async function searchNigeriaClaims(query) {
  const sources = [
    { list: "https://dubawa.org/category/fact-check/", host: "dubawa.org" },
    { list: "https://factcheckhub.com/", host: "factcheckhub.com" },
    { list: "https://factcheck.thecable.ng/", host: "thecable.ng" },
    { list: "https://www.premiumtimesng.com/category/news/fact-checks", host: "premiumtimesng.com" },
    { list: "https://africacheck.org/fact-checks", host: "africacheck.org" },
    { list: "https://factcheck.afp.com/AFP-Nigeria", host: "factcheck.afp.com" },

    { list: "https://factcheckhub.com/tag/asuu/", host: "factcheckhub.com" },

    { search: "https://dubawa.org", host: "dubawa.org" },
    { search: "https://africacheck.org", host: "africacheck.org" },
    { search: "https://factcheckhub.com", host: "factcheckhub.com" },
    { search: "https://factcheck.thecable.ng", host: "thecable.ng" },
    { search: "https://www.premiumtimesng.com", host: "premiumtimesng.com" }
  ];

  const collected = [];
  for (const s of sources) {
    try {
      const links = s.list
        ? await crawlListing(s.list, s.host)
        : await crawlSiteSearch(s.search, query || "", s.host);
      for (const u of links) {
        const items = await fetchClaimReviewsFromArticle(u);
        collected.push(...items);
      }
    } catch(_) {}
  }

  const seen = new Set();
  let unique = collected.filter(r => {
    const key = (r.reviewUrl || r.title);
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  if (query) {
    const q = query.toLowerCase();
    unique = unique.filter(r =>
      (r.title||"").toLowerCase().includes(q) ||
      (r.text||"").toLowerCase().includes(q)
    );
  }

  return unique.slice(0, 40);
}
