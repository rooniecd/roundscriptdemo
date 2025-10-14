// RoundScript frontend logic with detailed comments for clarity

/*
async function fetchFactChecks(query, lang) {
  const url = new URL('/api/search', API_BASE);
  url.searchParams.set('q', query);
  if (lang) url.searchParams.set('lang', lang);
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
*/

async function fetchFactChecksOnce(query, lang) {
  const url = new URL('/api/search', API_BASE);
  url.searchParams.set('q', query);
  if (lang && lang !== 'auto') url.searchParams.set('lang', lang);
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

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

  // 1) Orden de idiomas a probar
  const langOrder = [langSelected || 'en', (langSelected === 'es' ? 'en' : 'es'), 'auto'];

  // 2) Variantes de query (primero la original)
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
          // si ya conseguimos algo, podemos devolver de una
          if (aggregated.length >= 5) {
            return { query, results: aggregated };
          }
        }
      } catch (e) {
        // ignora y sigue probando
      }
    }
  }
  return { query, results: aggregated };
}


// Generate a short-form video script from normalized fact-check results
function buildScript(topic, normalized) {
  const bullets = normalized.results.slice(0, 5).map((r, i) => {
    const rating = r.rating ? ` (${r.rating})` : "";
    const pub = r.reviewPublisher ? ` — ${r.reviewPublisher}` : "";
    const link = r.reviewUrl ? `\nSource: ${r.reviewUrl}` : "";
    return `- ${r.title || r.text}${rating}${pub}${link}`;
  }).join("\n");

  return [
`HOOK: ${topic}? Let's check what the fact-checkers found.`,
"\nCONTEXT (5-8s):",
"• Here's the claim and what independent reviewers say.",
"",
"FINDINGS (15-30s):",
bullets,
"",
"NUANCE (5-10s):",
"• Ratings vary by context, date, and wording. Always read the full review.",
"",
"OUTRO (3-5s):",
"Thanks for watching. Like & follow for more verified explainers."
  ].join("\n");
}

function renderResults(listEl, data) {
  listEl.innerHTML = "";
  if (!data.results || !data.results.length) {
    listEl.innerHTML = "<li>No results found. Try rephrasing or another language.</li>";
    return;
  }
  for (const r of data.results) {
    const li = document.createElement("li");
    const title = r.title || r.text || "Untitled";
    const meta = [
      r.claimant ? `Claimant: ${r.claimant}` : null,
      r.claimDate ? `Claim date: ${r.claimDate}` : null,
      r.rating ? `Rating: ${r.rating}` : null,
      r.reviewPublisher ? `Publisher: ${r.reviewPublisher}` : null
    ].filter(Boolean).join(" • ");

    li.innerHTML = `
      <strong>${title}</strong><br>
      <small>${meta}</small><br>
      ${r.reviewUrl ? `<a href="${r.reviewUrl}" target="_blank" rel="noopener">Open review</a>` : ""}
    `;
    listEl.appendChild(li);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("searchForm");
  const q = document.getElementById("query");
  const lang = document.getElementById("lang");
  const status = document.getElementById("status");
  const results = document.getElementById("results");
  const scriptOut = document.getElementById("scriptOut");
  const copyBtn = document.getElementById("copyBtn");
  const downloadBtn = document.getElementById("downloadBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = q.value.trim();
    if (!query) return;

    status.textContent = "Searching…";
    results.innerHTML = "";
    scriptOut.value = "";

    try {
      // const data = await fetchFactChecks(query, lang.value);
			const data = await smartFactChecks(query, lang.value);
      renderResults(results, data);
      scriptOut.value = buildScript(query, data);
      status.textContent = `Found ${data.results?.length || 0} reviews`;
    } catch (err) {
      console.error(err);
      status.textContent = "Error fetching results. Check API_BASE in config.js and your Worker.";
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
