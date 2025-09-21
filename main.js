const form = document.getElementById('searchForm');
const resultsEl = document.getElementById('results');
const scriptEl = document.getElementById('script');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  const lang = document.getElementById('lang').value;
  if (!q) return;

  resultsEl.classList.remove('hide');
  resultsEl.innerHTML = `<p>Searching for “<strong>${escapeHtml(q)}</strong>”…</p>`;
  scriptEl.classList.add('hide');
  scriptEl.innerHTML = '';

  try {
		const API_BASE = "https://factcheck-worker.roundscriptdemo.workers.dev/api/search?q=the%20earth%20is%20flat&lang=en";
		const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&lang=${lang}`);
		const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Search failed');

    renderResults(data);
  } catch (err) {
    resultsEl.innerHTML = `<p style="color:#fda4af">${escapeHtml(err.message)}</p>`;
  }
});

function renderResults(data){
  const { claims = [], query } = data;
  if (!claims.length){
    resultsEl.innerHTML = `<p>No fact-checks found for “<strong>${escapeHtml(query)}</strong>”.</p>`;
    return;
  }
  const blocks = claims.map((c) => claimBlock(c)).join('');
  resultsEl.innerHTML = `<h2>Results (${claims.length})</h2>${blocks}`;
}

function claimBlock(c){
  const top = (c.claimReview || [])[0] || {};
  const rating = top.textualRating || 'Unrated';
  const pub = top.publisher || '';
  return `
  <div class="result">
    <div><strong>${escapeHtml(c.text || '(no text)')}</strong></div>
    <div>Source: ${escapeHtml(pub)} <span>[${escapeHtml(rating)}]</span></div>
    ${top.url ? `<div><a href="${top.url}" target="_blank">Read fact-check</a></div>` : ''}
  </div>`;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (m)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}
