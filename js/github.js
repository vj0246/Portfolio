/* github.js
   Reads /data/github_data.json (generated daily by scripts/fetch_data.py via the
   GitHub Action) and populates the "Live from GitHub" strip:
     #gh-repo-count → total public repos
     #gh-updated    → "synced Xh ago"
     #gh-recent     → up to 5 most recent pushes as links
   XSS-safe: all values are set via textContent / DOM nodes, never innerHTML,
   and repo URLs are allow-listed to https://github.com/ before use.
*/

document.addEventListener('DOMContentLoaded', () => {
  const repoCountEl = document.getElementById('gh-repo-count');
  const recentEl    = document.getElementById('gh-recent');
  const updatedEl   = document.getElementById('gh-updated');

  if (!repoCountEl && !recentEl) return;   // strip not on this page

  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 60)   return m + 'm ago';
    if (m < 1440) return Math.round(m / 60) + 'h ago';
    return Math.round(m / 1440) + 'd ago';
  };

  // Only ever trust an https github.com URL; anything else falls back to '#'
  const safeRepoUrl = (u) =>
    (typeof u === 'string' && /^https:\/\/github\.com\/[\w.\-\/]+$/.test(u)) ? u : '#';

  fetch('/data/github_data.json')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      if (repoCountEl && data.public_repo_count > 0) {
        repoCountEl.textContent = data.public_repo_count;
      }

      if (updatedEl && data.generated_at && data.generated_at !== 'pending first run') {
        updatedEl.textContent = 'synced ' + ago(data.generated_at);
      }

      if (recentEl && Array.isArray(data.recent_pushes) && data.recent_pushes.length) {
        const items = data.recent_pushes.slice(0, 5).map(r => {
          const a = document.createElement('a');
          a.className = 'gh-item';
          a.href = safeRepoUrl(r.html_url);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = r.name;                       // no HTML injection
          const t = document.createElement('span');
          t.className = 'gh-item-time';
          t.textContent = ago(r.pushed_at);
          a.append(t);
          return a;
        });
        recentEl.replaceChildren(...items);
      }
    })
    .catch(() => {
      // Silent: the static fallback text in the HTML stays as-is.
    });
});
