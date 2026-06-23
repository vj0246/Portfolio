# Dynamic Portfolio Pipeline — Setup Guide

How to make the portfolio auto-update whenever you push to GitHub
or update your Overleaf resume. Zero manual steps after initial setup.

---

## What gets automated

| Trigger | What happens |
|---------|-------------|
| You push any commit to any GitHub repo | `scripts/fetch_data.py` runs, updates `data/github_data.json`, Vercel redeploys |
| Daily at midnight | Same as above — catches anything missed |
| You update your resume on Overleaf | Overleaf pushes LaTeX to GitHub → PDF auto-compiled → portfolio links to latest |
| You update a project README | Next sync (push or daily) re-fetches the README content |

---

## PART 1 — GitHub auto-sync (takes ~10 min)

### Step 1: Push the portfolio to GitHub

The `.github/workflows/sync.yml` file in this folder must be in your
GitHub repo. If you've already pushed the portfolio, it's there.

### Step 2: Check the Action ran

Go to: `github.com/YOUR_USERNAME/portfolio` → Actions tab

You should see "Sync Portfolio Data" in the list. Click it → Run workflow
to trigger it manually the first time.

After it runs, `data/github_data.json` will have your real repo count
and recent pushes. Vercel will redeploy automatically.

### Step 3: Cross-repo triggers (optional but recommended)

To trigger a portfolio rebuild when you push to a **different** repo
(e.g. MindVault), add this file to each of those repos:

File: `MindVault/.github/workflows/notify-portfolio.yml`

```yaml
name: Notify Portfolio

on:
  push:
    branches: [main, master]
    paths:
      - 'README.md'        # only trigger on README changes

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger portfolio sync
        uses: peter-evans/repository-dispatch@v3
        with:
          token: ${{ secrets.PORTFOLIO_PAT }}
          repository: vj0246/portfolio
          event-type: readme-updated
          client-payload: '{"repo": "${{ github.event.repository.name }}"}'
```

For this to work, create a GitHub Personal Access Token (PAT):
1. github.com → Settings → Developer Settings → Personal access tokens → Fine-grained
2. Give it access to the `portfolio` repo with "Actions: write" permission
3. Copy the token
4. Go to each project repo → Settings → Secrets → New secret
5. Name: `PORTFOLIO_PAT`, Value: the token you copied

Then add this trigger to `portfolio/.github/workflows/sync.yml`:
```yaml
on:
  repository_dispatch:
    types: [readme-updated]
  schedule:
    ...
```

---

## PART 2 — Overleaf resume auto-sync (takes ~20 min)

### Step 1: Enable Overleaf → GitHub sync

1. Open your resume project on Overleaf
2. Menu (top left) → Sync → GitHub
3. Connect your GitHub account if not already done
4. Create a new repo called `vivaan-resume` (private is fine)
5. Click "Push to GitHub"

Now every time you click "Push to GitHub" in Overleaf, your LaTeX
source goes to `github.com/vj0246/vivaan-resume`.

### Step 2: Auto-compile PDF in GitHub Actions

Add this file to the resume repo:

File: `vivaan-resume/.github/workflows/compile.yml`

```yaml
name: Compile Resume PDF

on:
  push:
    branches: [main, master]

jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Compile LaTeX
        uses: xu-cheng/latex-action@v3
        with:
          root_file: main.tex   # change to your main .tex filename

      - name: Commit compiled PDF
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add resume.pdf
          git diff --staged --quiet || git commit -m "chore: compile resume [skip ci]"
          git push
```

### Step 3: Point portfolio to the compiled PDF

In `index.html`, update the resume modal links from `href="#"` to the
raw GitHub URL of the compiled PDF:

```html
<a class="resume-opt" href="https://raw.githubusercontent.com/vj0246/vivaan-resume/main/resume.pdf" ...>
```

Every time you update Overleaf → Push to GitHub → PDF auto-compiles →
portfolio link always points to the latest version.

### Step 4: Make the repo public (or use GitHub Pages)

For the PDF link to work without authentication:
- Make `vivaan-resume` a public repo, OR
- Use GitHub Pages: repo Settings → Pages → Source: main branch → /root
  Then link to: `https://vj0246.github.io/vivaan-resume/resume.pdf`

GitHub Pages URL is cleaner and works even with private repos if you
set up the Pages action correctly.

---

## PART 3 — How the portfolio reads live data

`js/github.js` runs on every page load and fetches `/data/github_data.json`.
This file is rebuilt by `scripts/fetch_data.py` on every sync.

The JSON contains:
- `public_repo_count` → shown in the hero/sidebar
- `recent_pushes` → shown as a live activity feed (if you add `#gh-recent` to HTML)
- `readmes` → raw README content from each key project repo

To add more repos to the README fetch, edit `KEY_REPOS` in `scripts/fetch_data.py`:

```python
KEY_REPOS = [
    "MindVault",
    "Multi-Horizon-Transformer-for-Systematic-Equity-Direction-Forecasting",
    "auditmind-ai",
    "Text-Sentiment-Classification-System",
    "Shakti-Site",
    "your-new-repo-name",   # add here
]
```

---

## Summary of files

```
portfolio/
├── .github/
│   └── workflows/
│       └── sync.yml          ← GitHub Action (auto-runs daily + on push)
├── scripts/
│   └── fetch_data.py         ← fetches GitHub API, writes github_data.json
├── data/
│   └── github_data.json      ← auto-generated, read by github.js
├── js/
│   └── github.js             ← reads github_data.json, updates DOM
└── index.html                ← portfolio site
```

---

## Troubleshooting

**Action fails with 403:** The GITHUB_TOKEN secret is auto-provided by
GitHub Actions — you don't need to add it manually. If it fails, check
that the repo has Actions enabled (Settings → Actions → Allow all actions).

**PDF link returns 404:** Make sure the repo is public, the file is
named exactly `resume.pdf`, and it's on the `main` branch.

**Data not updating:** Check the Actions tab for error logs. The most
common issue is a typo in `GITHUB_USERNAME` in the workflow file.
