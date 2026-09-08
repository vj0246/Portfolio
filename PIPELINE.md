# Portfolio — Maintenance Guide

How to add a project, and how the automation actually works.

The site is a **static single page** — `index.html` + `css/style.css` + two small vanilla JS
files. No framework and no bundler. The one build step renders project cards from JSON.

---

## Add a project

```bash
cd "C:/Users/vivaa/OneDrive/Desktop/Personal Projects/Portfolio/v5"

cp content/projects/_TEMPLATE.json content/projects/proj-050-quantstorm.json
# edit that file
python scripts/publish.py
```

That is the whole workflow. `publish.py` builds the cards, runs the checks, shows you the diff,
asks once, then commits, rebases, and pushes. Vercel redeploys about 30 seconds later.

### Step 1 — read the repo's README first

Pull these out of the project's own `README.md`, **verbatim, never invent numbers**:

| From the README | Goes into |
|---|---|
| One-line what-it-does | `tagline` |
| Real tech stack | `tags` and the `Stack` sidebar block |
| Hard numbers (Sharpe, latency, test count, accuracy) | a `table` block, and the `Key metrics` sidebar |
| The pipeline or data flow | an `arch` block |
| Results that did **not** work | a `nulls` block — on a quant page these carry more weight than the wins |
| Live URL and GitHub URL | the `Links` sidebar block |
| Status | `badge` |

READMEs drift. A number that the repo now contradicts is worse than no number. Check the live
README, not an older copy of this site.

Verify every demo URL before writing it in:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L https://your-demo.vercel.app
```

`python scripts/validate.py --links` does this for every link on the page at once.

### Step 2 — name the file

`<section>-<order>-<id>.json`, for example `proj-050-quantstorm.json`.

| `section` | Renders in | Numbered |
|---|---|---|
| `projects` | §1 Quantitative Research | `1.1`, `1.2`, `1.3`… |
| `frontier` | §2 Research | `2.1`, `2.2`… |
| `engineering` | §3 Engineering | `3.1`, `3.2`… |

Section numbers come from `PAGE_SECTIONS` in `build.py`, which lists every section on the page in
order. Reordering sections there renumbers both the headings and every card under them.

The site leads with quant. A project belongs in `projects` only if it is quantitative research;
shipped applications go in `engineering`.

`order` is the sort key inside its section. Existing cards use gaps of 10, so to slot a project
between `010` and `020` give it `015` — no other file needs touching. **Card numbers are derived
from position, so renumbering happens on its own.**

Files beginning with `_` are ignored by the build, which is why `_TEMPLATE.json` is safe to leave
in place.

### Step 3 — fill in the fields

`_TEMPLATE.json` carries the full schema in its `_readme` key, with every block type and every
option. Delete that key in your copy. The short version:

```jsonc
{
  "section": "projects",
  "order": 50,
  "id": "quantstorm",                                  // becomes id="proj-quantstorm", must be unique
  "name": "QuantStorm 2026",
  "badge": { "kind": "research", "text": "Competition" },
  "tagline": "One or two sentences.",
  "tags": ["Python", "Game Theory"],
  "blocks":  [ /* text | bullets | arch | table | nulls | html */ ],
  "sidebar": [ /* tags | metrics | links */ ]
}
```

String values are emitted as HTML, so `<code>`, `<strong>` and `&amp;` all work inside them.
The content is authored in this repo and never comes from a visitor, so nothing is escaped.

### Step 4 — build and look at it

```bash
python scripts/build.py     # rewrites the card lists in index.html
python scripts/validate.py  # tag balance, anchors, duplicate ids, numbering, assets
```

Then open `index.html` in a browser and click the new card. `publish.py` runs both scripts for
you, but running them directly is the faster loop while you are still editing.

### Step 5 — ship

```bash
python scripts/publish.py              # build, check, diff, confirm, push
python scripts/publish.py --links      # ...and verify every external URL first
python scripts/publish.py --dry-run    # everything except commit and push
python scripts/publish.py -m "feat(projects): add QuantStorm card"
```

It refuses to run off `main`, never force-pushes, and if the rebase conflicts it stops and leaves
your commit intact for you to finish by hand.

---

## Block types

Full details in `_TEMPLATE.json`. Summary:

| Type | Renders |
|---|---|
| `text` | prose paragraphs |
| `bullets` | the standard dotted list |
| `arch` | architecture diagram |
| `table` | results table |
| `nulls` | red-ruled callout for negative results |
| `html` | escape hatch, raw markup for anything the schema misses |

**`arch` flow shorthand** — one array, read left to right:

```json
"flow": ["NSE Bhavcopy|corporate actions", "->", "*Validation|purged CV · CPCV", "->", "Book"]
```

`Label|small text` is a normal box, a leading `*` makes it a highlighted box, `->` is an arrow, and
`+` is a plus for parallel inputs merging. Use `"flows": [[...], [...]]` for more than one row.

**`table` cells** — prefix a row's first cell with `*` to highlight the row; append `|pos`, `|neg`,
`|flat` or `|amber` to any cell to colour it like a PnL readout.

**Sidebar metrics** take the same tones: `["Net Sharpe", "1.02", "pos"]`.

**`lede`** is the one-line summary shown next to the card in the contents list on the first screen.
Keep it short: it sits after a dotted leader and is truncated if it runs long. Omit it and the card
still appears in the contents, just without the trailing note.

### Badges

| `kind` | Colour |
|---|---|
| `live` | green, PnL positive |
| `progress` | amber |
| `research` | sky |
| `published` | blue |
| `freelance` | grey |
| `intern` | red |

`text` is free-form, so `● Live · Operated` and `v0.1 · Alpha` are both fine.

---

## What you do **not** touch

The contents list on the first screen is generated from the same card files, between
`<!-- CONTENTS:START -->` and `<!-- CONTENTS:END -->`. `validate.py` fails if a card exists without
a contents entry, or the reverse.

Do not hand-edit a `<details class="proj-card">` block in `index.html`. Everything between the
`<!-- CARDS:START ... -->` and `<!-- CARDS:END ... -->` markers is generated, and the next
`build.py` will overwrite it. CI fails the commit if the two ever disagree
(`python scripts/build.py --check`).

Everything else about a card — the `◆ tearsheet` label, the gradient edge, scroll reveal, 3D tilt,
expand and collapse — comes from existing CSS selectors. That is why every card looks consistent.

---

## Front-end conventions

`index.html` carries **no inline JavaScript and no inline event handlers** (`onclick=` and friends).
All behaviour lives in `js/main.js`, loaded with `defer`; the GitHub strip lives in `js/github.js`.
For a new interaction, add a small `init*()` function in `main.js` and call it from the boot block
at the bottom. `validate.py` fails the build if an inline handler reappears.

The one remaining inline `<script>` is the JSON-LD `Person` block in `<head>`, which is data, not
code. That is also why `script-src` still carries `'unsafe-inline'`: browsers apply it to
`application/ld+json` too, so removing it would drop the structured data.

Accessibility invariants worth not breaking: a skip link is the first tab stop, `:focus-visible`
gives every interactive element a visible ring, the resume modal traps focus and restores it on
close, and card titles carry `role="heading" aria-level="3"`. A `<noscript>` block in `<head>`
disables the intro overlay and forces `[data-reveal]` content visible, so the page still reads
with JavaScript off.

---

## The automation

Three independent systems. Do not confuse them.

| System | What it does | Involved when adding a project? |
|---|---|---|
| **Vercel auto-deploy** | Watches the repo. Every push to `main` rebuilds and redeploys in ~30s. The only thing that publishes changes. | **Yes** — push means live. |
| **CI (`ci.yml`)** | On every push and PR: `build.py --check`, `validate.py`, and `node --check` on both JS files. | Only as a safety net. |
| **Sync (`sync.yml`)** | Daily at 18:30 UTC, runs `scripts/fetch_data.py` to rewrite `data/github_data.json`, which feeds the "Live from GitHub" strip. | **No** — it powers the strip, not the cards. |

```
edit content/projects/*.json  ->  publish.py  ->  Vercel redeploys  ->  LIVE
sync.yml (daily)              ->  data/github_data.json  ->  js/github.js  ->  strip updates itself
```

### The "Live from GitHub" strip

`scripts/fetch_data.py` calls the GitHub API, paginates the public repos, and writes
`data/github_data.json`: repo count, the 8 most recent pushes, all repos, and the READMEs of the
repos listed in `KEY_REPOS`. `js/github.js` reads it and fills `#gh-repo-count`, `#gh-updated` and
`#gh-recent`.

It is XSS-safe: values are set with `textContent` / `replaceChildren`, never `innerHTML`, and repo
URLs are allow-listed to `https://github.com/` before use. If the fetch fails, the static fallback
text in `index.html` stays in place, so it never looks broken.

Adding a big project? Add its repo name to `KEY_REPOS` in `scripts/fetch_data.py` so its README
gets pulled into the data file.

---

## Security and headers

`vercel.json` sets CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`
and `X-Robots-Tag: all`. **Adding a new external resource — a font host, a script, an analytics tag
— means adding its origin to the matching CSP directive, or the browser silently blocks it.**

Static assets are cached at the CDN with `s-maxage` and revalidated by the browser. They are *not*
`immutable`: filenames are not content-hashed, so an immutable header would pin stale CSS in
visitors' browsers across deploys.

`robots.txt` allows everything, and names the AI and LLM crawlers explicitly so a crawler that
defaults to deny-unless-listed still resolves to allow.
