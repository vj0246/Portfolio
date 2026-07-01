"""
fetch_data.py
Runs in GitHub Actions. Fetches all public repos for GITHUB_USERNAME,
extracts metadata, and writes data/github_data.json.
Vercel redeploys automatically when this file changes.

Usage locally:
  GITHUB_TOKEN=your_token GITHUB_USERNAME=vj0246 python scripts/fetch_data.py
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

USERNAME = os.environ.get("GITHUB_USERNAME", "vj0246")
TOKEN    = os.environ.get("GITHUB_TOKEN", "")

HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}
if TOKEN:
    HEADERS["Authorization"] = f"Bearer {TOKEN}"


def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} for {url}", file=sys.stderr)
        return None


def fetch_readme(owner, repo):
    """Return README text or empty string."""
    data = get(f"https://api.github.com/repos/{owner}/{repo}/readme")
    if not data:
        return ""
    import base64
    try:
        return base64.b64decode(data.get("content", "")).decode("utf-8", errors="ignore")
    except Exception:
        return ""


def main():
    print(f"Fetching repos for {USERNAME}...")

    # Paginate through all public repos
    repos = []
    page = 1
    while True:
        batch = get(
            f"https://api.github.com/users/{USERNAME}/repos"
            f"?type=owner&sort=pushed&per_page=100&page={page}"
        )
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1

    print(f"Found {len(repos)} repos")

    # Key repos to fetch READMEs for (update this list as you add projects)
    KEY_REPOS = [
        "MindVault",
        "Multi-Horizon-Transformer-for-Systematic-Equity-Direction-Forecasting",
        "auditmind-ai",
        "Shakti-Site",
        "ApplyPilot-AI",
    ]

    readmes = {}
    for repo_name in KEY_REPOS:
        print(f"Fetching README for {repo_name}...")
        text = fetch_readme(USERNAME, repo_name)
        readmes[repo_name] = text[:4000] if text else ""  # cap at 4000 chars

    # Build output
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "username": USERNAME,
        "public_repo_count": len(repos),
        "recent_pushes": [
            {
                "name":        r["name"],
                "description": r.get("description") or "",
                "language":    r.get("language") or "",
                "pushed_at":   r["pushed_at"],
                "html_url":    r["html_url"],
                "homepage":    r.get("homepage") or "",
                "stars":       r["stargazers_count"],
            }
            for r in repos[:8]   # 8 most recently pushed
        ],
        "all_repos": [
            {
                "name":      r["name"],
                "language":  r.get("language") or "",
                "pushed_at": r["pushed_at"],
            }
            for r in repos
        ],
        "readmes": readmes,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "github_data.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Written to {out_path}")
    print(f"Repo count: {output['public_repo_count']}")
    print(f"Recent pushes: {[r['name'] for r in output['recent_pushes']]}")


if __name__ == "__main__":
    main()