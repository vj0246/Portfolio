# Portfolio — Maintenance Guide

How to add a project, and how the automation actually works.

This site is a **static single page** (`index.html` + `css/style.css` + a little vanilla JS).
No framework, no build step. You edit HTML, push, and Vercel redeploys.

---

## The two automations (do not confuse them)

There are two completely independent systems:

| System | What it does | Involved when adding a project? |
|--------|--------------|--------------------------------|
| **Vercel auto-deploy** | Watches the GitHub repo. Every push to `main` triggers an automatic rebuild + redeploy (~30s). This is the only thing that publishes your changes. | **Yes** — push = live. |
| **GitHub Action (`sync.yml`)** | Runs `scripts/fetch_data.py`, which writes `data/github_data.json` (repo count, recent pushes, READMEs). Feeds the "Live from GitHub" strip under the Projects heading. | **No** — it powers the live strip, not the project cards. |

### What the GitHub Action feeds

`index.html` loads `js/github.js`, which fetches `data/github_data.json` and fills the
**"Live from GitHub"** strip under the Projects heading (`#gh-repo-count`, `#gh-updated`,
`#gh-recent`). So the Action keeps that strip current — public repo count, "synced Xh ago",
and the most recent pushes — with zero manual work.

It does **not** touch your project cards. **Adding a project is still 100% a manual HTML edit.**

Mental model:

```
You edit index.html  --push-->  Vercel redeploys  -->  LIVE            (this is "adding a project")
sync.yml (daily)     -->  refreshes data/github_data.json  --push-->  Vercel redeploys
                     -->  js/github.js reads it  -->  "Live from GitHub" strip updates itself
```

---

## Part 1 — Add a new project (the manual part)

### Step 1: Study the repo's README first

Pull these out of the project's `README.md`, **verbatim — never invent numbers**:

- One-line what-it-does → **tagline**
- Real tech stack → **tags** + **sidebar Stack**
- Hard numbers (latency, test cases, tools, users, accuracy…) → **Key metrics**
- The pipeline / data flow → **Architecture** nodes
- Live URL + GitHub URL → **Links**
- Status (live / in progress / research) → **badge**

### Step 2: Copy an existing card

Each project is one `<details class="proj-card" id="proj-XXX"> … </details>` block inside
`<section id="projects">` → `<div class="proj-list">`.

- Has a live demo → copy `proj-finintel` or `proj-applypilot` (GitHub + Live links).
- No demo → copy `proj-auditmind` (GitHub link only).

### Step 3: Paste in the position you want

Order on the page = top-to-bottom order of the blocks in the file. Drop the copy where it should appear.

### Step 4: Change exactly these fields

```html
<details class="proj-card" id="proj-YOURNAME">        <!-- unique id -->
  ...
  <span class="proj-num">06</span>                    <!-- sequence number -->
  <span class="proj-name">Project Name</span>         <!-- title -->
  <span class="badge live">● Live</span>              <!-- badge: see table below -->
  <p class="proj-tagline">One sentence: what it is + why it matters.</p>
  <div class="proj-tags">                              <!-- 4-6 chips -->
    <span class="tag">FastAPI</span><span class="tag">Groq</span>
  </div>
  ...
  <!-- "What it does": 1-2 <p> paragraphs -->
  <!-- "Architecture": arch-node boxes (see reference below) -->
  <!-- "Technical depth": <li> bullets in <ul class="detail-bullets"> -->
  <!-- Sidebar: Stack tags, Key metrics rows, Links -->
  <a href="https://github.com/vj0246/REPO" target="_blank" rel="noopener" class="sb-link">GitHub Repository <span>↗</span></a>
  <a href="https://YOURAPP.vercel.app" target="_blank" rel="noopener" class="sb-link">Live Demo <span>↗</span></a>
</details>
```

### Step 5: Renumber

If you inserted in the middle, fix `<span class="proj-num">NN</span>` on the cards below so the
sequence stays 01, 02, 03…

### Step 6: What you do NOT touch

Nothing else. No JS, no `data/`, no CSS. The `◆ model-card` badge, gradient edge, scroll-reveal,
3D tilt, and expand/collapse all auto-apply from existing selectors. That is why every card looks
consistent.

### Step 7: Test, then ship

```bash
# Preview locally first: open v5/index.html in your browser, click the new card.
cd "C:/Users/vivaa/OneDrive/Desktop/Personal Projects/Portfolio/v5"
git add index.html
git commit -m "feat(projects): add <Name> project card"
git pull --rebase origin main   # CI commits data back; always rebase first
git push
```

Push → Vercel redeploys in ~30s → live.

> Research-section project? Same block, but paste inside `<section id="research">`,
> use `badge research`, and number it `R2`, `R3`, …

---

## Reference: card building blocks

### Badge options (pick one)

| Class | Renders |
|-------|---------|
| `badge live` | ● Live |
| `badge progress` | In Development |
| `badge research` | Research |

### Architecture flow pieces (inside `.arch-flow`)

| Markup | Purpose |
|--------|---------|
| `<div class="arch-node">Label<br><small>detail</small></div>` | Normal box |
| `<div class="arch-node key">…</div>` | Highlighted (teal) box — use for the important steps |
| `<span class="arch-arr">→</span>` | Arrow between boxes |
| `<span class="arch-plus">+</span>` | Plus sign (for parallel inputs merging) |

### Metric row (inside `.sb-metrics`)

```html
<div class="metric-row"><span class="metric-label">Query latency</span><span class="metric-val">40% faster</span></div>
```

---

## Part 2 — How the GitHub Action works (`.github/workflows/sync.yml`)

```
Triggers:  daily 18:30 UTC (cron)
           manual  (GitHub → Actions tab → "Sync Portfolio Data" → Run workflow)
           push to main  (skipped for pushes that only touch data/** or *.md)

Steps:     checkout → set up Python 3.11 → pip install requests
           → run scripts/fetch_data.py   (env: GITHUB_TOKEN, GITHUB_USERNAME=vj0246)
           → if data/github_data.json changed → commit "[skip ci]" → push

Hardening: permissions: contents: write   (least privilege — only needs to commit data back)
           concurrency group                (a scheduled run and a push run never race on git push)
```

`scripts/fetch_data.py` calls the GitHub API, paginates your public repos, and writes
`data/github_data.json`: public repo count, 8 most recent pushes, all repos, and the READMEs of the
repos listed in `KEY_REPOS`.

### The "Live from GitHub" strip (wired)

`js/github.js` reads this JSON and populates the strip under the Projects heading. It is XSS-safe:
values are set with `textContent` / `replaceChildren` (never `innerHTML`), and repo URLs are
allow-listed to `https://github.com/` before use. If the fetch ever fails, the static fallback text
in `index.html` (`25+ public repos · auto-synced daily`) stays in place, so it never looks broken.

The strip updates on its own: the daily cron rewrites `data/github_data.json` → the commit push
triggers a Vercel redeploy → the new JSON is served → the strip shows fresh numbers. No action needed.

If you add a big new project and want its README pulled into the data file, add its repo name to the
`KEY_REPOS` list in `scripts/fetch_data.py`.

---

## Security / headers

Security headers (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) are set in
`vercel.json`. If you add a new external resource (a font host, a script, an analytics tag), you must
add its origin to the matching CSP directive in `vercel.json`, or the browser will block it.
