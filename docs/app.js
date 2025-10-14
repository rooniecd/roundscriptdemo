// Front logic with Nigeria mode + "Related Article" labels
function api(base, path, params) {
  const url = new URL(path, base);
  if (params) Object.entries(params).forEach(([k, v]) => v!=null && url.searchParams.set(k, v));
  return fetch(url.toString(), { headers: { "Accept": "application/json" }}).then(r => {
    if (!r.ok) throw new Error("API " + r.status);
    return r.json();
  });
}

function renderResults(listEl, data) {
  listEl.innerHTML = "";
  const results = data.results || [];
  if (!results.length) {
    listEl.innerHTML = "<li>No results. Try another variant (e.g., add 'fact-check', 'false', or use Nigeria mode).</li>";
    return;
  }
  for (const r of results) {
    const li = document.createElement("li");
    const rating = r.rating ? `<strong>${r.rating}</strong>` : `<em>Related Article</em>`;
    const meta = [
      r.reviewPublisher ? `Source: ${r.reviewPublisher}` : null,
      r.claimant ? `Claimant: ${r.claimant}` : null,
      r.claimDate ? `Date: ${r.claimDate}` : null
    ].filter(Boolean).join(" • ");
    li.innerHTML = `
      <div>${rating}</div>
      <div><strong>${r.title || r.text || "Untitled"}</strong></div>
      <div><small>${meta}</small></div>
      ${r.reviewUrl ? `<a href="${r.reviewUrl}" target="_blank" rel="noopener">Open</a>` : ""}
    `;
    listEl.appendChild(li);
  }
}

function buildScript(topic, data) {
  const lines = (data.results || []).slice(0,8).map(r => {
    const tag = r.rating ? `[${r.rating}]` : `[Related]`;
    const pub = r.reviewPublisher ? ` — ${r.reviewPublisher}` : "";
    return `- ${tag} ${r.title || r.text}${pub}${r.reviewUrl ? `\n  ${r.reviewUrl}` : ""}`;
  });
  return [
    `HOOK: ${topic}? Let's verify with trusted sources.`,
    "",
    "FINDINGS:",
    ...lines,
    "",
    "NOTE: Some items may be related context (no formal verdict). Always read full sources."
  ].join("\n");
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

  let nigeriamode = document.getElementById("nigeriaMode");
  if (!nigeriamode) {
    const p = document.createElement("p");
    p.style.margin = "8px 0";
    p.innerHTML = `<label><input id="nigeriaMode" type="checkbox"> Nigeria mode (prefer local fact-checkers)</label>`;
    form.parentElement.insertBefore(p, form.nextSibling);
    nigeriamode = document.getElementById("nigeriaMode");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = q.value.trim();
    if (!query) return;
    scriptOut.value = "";
    results.innerHTML = "";
    status.textContent = "Searching…";

    try {
      let data;
      if (nigeriamode.checked) {
        data = await api(API_BASE, "/api/ng-search", { q: query });
        if (!data.results || data.results.length === 0) {
          const g = await api(API_BASE, "/api/search", { q: query, lang: lang.value || "auto" });
          data = g;
        }
      } else {
        data = await api(API_BASE, "/api/search", { q: query, lang: lang.value || "auto" });
        if (!data.results || data.results.length === 0) {
          const variants = [
            `"${query}"`, `${query} fact-check`, `${query} false`,
            `${query} misinformation`, `${query} verificación`
          ];
          for (const v of variants) {
            const g2 = await api(API_BASE, "/api/search", { q: v, lang: "auto" });
            if (g2.results && g2.results.length) { data = g2; break; }
          }
          if (!data.results || !data.results.length) {
            const ng = await api(API_BASE, "/api/ng-search", { q: query });
            if (ng.results && ng.results.length) data = ng;
          }
        }
      }

      renderResults(results, data);
      scriptOut.value = buildScript(query, data);
      status.textContent = `Found ${data.results?.length || 0} items`;
    } catch (err) {
      console.error(err);
      status.textContent = "Error fetching results. Check your API_BASE or CORS.";
    }
  });

  copyBtn?.addEventListener("click", async () => {
    if (!scriptOut.value) return;
    try { await navigator.clipboard.writeText(scriptOut.value); } catch {}
    copyBtn.textContent = "Copied!";
    setTimeout(()=>copyBtn.textContent="Copy Script", 1200);
  });

  downloadBtn?.addEventListener("click", () => {
    if (!scriptOut.value) return;
    const blob = new Blob([scriptOut.value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "roundscript_script.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });
});
