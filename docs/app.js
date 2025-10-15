// Frontend with Strict Match checkbox
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("searchForm");
  const q = document.getElementById("query");
  const results = document.getElementById("results");
  const status = document.getElementById("status");
  const strictCb = document.createElement("p");
  strictCb.innerHTML = '<label><input id="strictMatch" type="checkbox" checked> Strict match (AND)</label>';
  form.parentElement.insertBefore(strictCb, form.nextSibling);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    results.innerHTML = "";
    status.textContent = "Searching...";
    const query = q.value.trim();
    const strict = document.getElementById("strictMatch").checked ? "1" : "0";
    const url = `https://roundscript-api.roundscriptdemo.workers.dev/api/ng-search?q=${encodeURIComponent(query)}&strict=${strict}&host=factcheckhub.com`;
    const res = await fetch(url);
    const data = await res.json();
    results.innerHTML = data.results.map(r => `<li><a href="${r.reviewUrl}" target="_blank">${r.title}</a></li>`).join("");
    status.textContent = `Found ${data.results.length} results`;
  });
});
