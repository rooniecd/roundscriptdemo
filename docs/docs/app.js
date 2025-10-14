// RoundScript frontend with Nigeria mode + smart fallbacks
// Assumes existing HTML IDs: searchForm, query, lang, status, results, scriptOut, copyBtn, downloadBtn

// ---------- API helpers ----------
async function fetchFactChecksOnce(query, lang) {
  const url = new URL('/api/search', API_BASE);
  url.searchParams.set('q', query);
  if (lang && lang !== 'auto') url.searchParams.set('lang', lang);
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function fetchNigeria(query) {
  const url = new URL('/api/ng-search', API_BASE);
  if (query) url.searchParams.set('q', query);
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// Try multiple language/query variants and merge unique results
async function smartFactChecks(query, langSelected) {
  const tried = new Set();
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(r => {
      const key = [r.title, r.reviewUrl].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const langOrder = [langSelected || 'en', (langSelected === 'es' ? 'en' : 'es'), 'auto'];
  const variants = [
    query,
    `"${query}"`,
    `${query} fact-check`,
    `${query} verificación`,
    `${query} falso`,
    `${query} bulo`
  ];

  let aggregated = [];
  for (const l of langOrder) {
    for (const v of variants) {
      const key = `${l}|${v}`;
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        const data = await fetchFactChecksOnce(v, l);
        if (Array.isArray(data.results) && data.results.length) {
          aggregated = dedup(aggregated.concat(data.results));
          if (aggregated.length >= 6) return { query, results: aggregated };
        }
      } catch {}
    }
  }
  return { query, results: aggregated };
}

// ---------- Script builder ----------
function buildScript(topic, normalized) {
  const bullets = (normalized.results || []).slice(0, 6).map(r => {
    const rating = r.rating ? ` (${r.rating})` : "";
    const pub = r.reviewPublisher ? ` — ${r.reviewPublisher}` : "";
    const link = r.reviewUrl ? `\nSource: ${r.reviewUrl}` : "";
    return `- ${r.title || r.text || "Untitled"}${rating}${pub}${link}`;
  }).join("\n");

  return [
`HOOK: ${topic}? Let's check what fact-checkers and trusted sources say.`,
"\nCONTEXT (5–8s):",
"• Here's the claim and what reviewers report.",
"",
"FINDINGS (15–30s):",
bullets || "- No verified reviews found. Consider rephrasing the query or trying Nigeria mode.",
"",
"NUANCE (5–10s):",
"• Ratings vary by context, date, and wording. Always open the source.",
"",
"OUTRO (3–5s):",
"Thanks for watching. Like & follow for more verified explainers."
  ].join("\n");
}

// Label results without rating as Related Article
function renderResults(listEl, data) {
  listEl.innerHTML = "";
  const arr = data.results || [];
  if (!arr.length) {
    listEl.innerHTML = "<li>No results found. Try rephrasing, switching language, or enabling Nigeria mode.</li>";
    return;
  }
  for (const r of arr) {
    const li = document.createElement("li");
    const title = r.title || r.text || "Untitled";
    const metaParts = [];
    if (r.claimant) metaParts.push(`Claimant: ${r.claimant}`);
    if (r.claimDate) metaParts.push(`Date: ${r.claimDate}`);
    if (r.reviewPublisher) metaParts.push(`Publisher: ${r.reviewPublisher}`);

    let badge = "";
    if (r.rating && r.rating.trim()) {
      badge = `<span class="badge" style="margin-right:8px;">Fact-Check</span>`;
    } else {
      badge = `<span class="badge" style="margin-right:8px;background:#f2f4f7;border-color:#e5e7eb;color:#475467;">Related Article</span>`;
    }

    li.innerHTML = `
      ${badge}<strong>${title}</strong><br>
      <small>${metaParts.join(" • ") || ""}</small><br>
      ${r.reviewUrl ? `<a href="${r.reviewUrl}" target="_blank" rel="noopener">Open source</a>` : ""}
    `;
    listEl.appendChild(li);
  }
}

// ---------- UI wiring ----------
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("searchForm");
  const q = document.getElementById("query");
  const lang = document.getElementById("lang");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const scriptOut = document.getElementById("scriptOut");
  const copyBtn = document.getElementById("copyBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  // Inject Nigeria mode toggle under the form
  const toggleWrap = document.createElement("div");
  toggleWrap.style.margin = "8px 0 0";
  toggleWrap.innerHTML = `
    <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" id="ngMode">
      <span>Nigeria mode (prefer local fact-checkers)</span>
    </label>
  `;
  form.insertAdjacentElement("afterend", toggleWrap);
  const ngMode = toggleWrap.querySelector("#ngMode");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = q.value.trim();
    if (!query) return;

    status.textContent = "Searching…";
    results.innerHTML = "";
    scriptOut.value = "";

    try {
      let merged = { query, results: [] };

      if (ngMode.checked) {
        // 1) Nigeria first
        const ng = await fetchNigeria(query);
        merged.results = (ng.results || []);
        // if empty, fall back to Google smart
        if (!merged.results.length) {
          const g = await smartFactChecks(query, lang.value);
          merged.results = (merged.results || []).concat(g.results || []);
        }
      } else {
        // Google smart first
        const g = await smartFactChecks(query, lang.value);
        merged.results = g.results || [];

        // if empty, try Nigeria as a fallback
        if (!merged.results.length) {
          const ng = await fetchNigeria(query);
          merged.results = (merged.results || []).concat(ng.results || []);
        }
      }

      renderResults(results, merged);
      scriptOut.value = buildScript(query, merged);
      status.textContent = `Found ${merged.results?.length || 0} sources`;
    } catch (err) {
      console.error(err);
      status.textContent = "Error fetching results. Check API_BASE and your Worker deployment.";
    }
  });

  copyBtn.addEventListener("click", async () => {
    if (!scriptOut.value) return;
    try { await navigator.clipboard.writeText(scriptOut.value); } catch {}
    copyBtn.textContent = "Copied!";
    setTimeout(() => copyBtn.textContent = "Copy Script", 1200);
  });

  downloadBtn.addEventListener("click", () => {
    if (!scriptOut.value) return;
    const blob = new Blob([scriptOut.value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "roundscript_script.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });
});
