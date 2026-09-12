"""
validate.py
Structural checks on the built site. Run by publish.py before every push, and by
CI on every commit.

These are the failures that have actually happened on this site, not a generic
linter: an unbalanced tag from a hand-edited card, a nav link pointing at a
section id that was renamed, a demo URL that 404s, an inline handler creeping
back in, malformed JSON-LD.

Usage:
    python scripts/validate.py            # structure only, no network
    python scripts/validate.py --links    # also check every external URL resolves
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"

# Tags whose open/close counts must match. Void and self-closing tags are excluded.
PAIRED_TAGS = (
    "html", "head", "body", "nav", "main", "section", "details", "summary",
    "table", "thead", "tbody", "tr", "td", "th", "caption",
    "div", "ul", "ol", "li", "p", "a", "button", "span", "h1", "h2", "h3",
    "footer", "style", "script", "noscript",
)


def check_tag_balance(html: str) -> list[str]:
    problems = []
    for tag in PAIRED_TAGS:
        opened = len(re.findall(r"<%s[\s>]" % tag, html))
        closed = len(re.findall(r"</%s>" % tag, html))
        if opened != closed:
            problems.append(f"<{tag}>: {opened} opened, {closed} closed")
    return problems


def check_anchors(html: str) -> list[str]:
    ids = set(re.findall(r'<section id="([^"]+)"', html))
    ids |= set(re.findall(r'\sid="([^"]+)"', html))
    targets = {a for a in re.findall(r'href="#([^"]+)"', html)}
    return [f"#{a} has no matching id" for a in sorted(targets - ids)]


def check_no_inline_handlers(html: str) -> list[str]:
    found = re.findall(r"\s(on\w+)=\"", html)
    return [f"inline event handler {h}= (behaviour belongs in js/main.js)" for h in sorted(set(found))]


def check_json_ld(html: str) -> list[str]:
    m = re.search(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', html, re.S)
    if not m:
        return ["JSON-LD Person block is missing"]
    try:
        json.loads(m.group(1))
    except json.JSONDecodeError as e:
        return [f"JSON-LD does not parse: {e}"]
    return []


def check_card_numbering(html: str) -> list[str]:
    """Cards are numbered like a paper: the third card in §2 is 2.3.

    The expected numbers come from build.py rather than a second copy of the
    rule, so the two can never disagree about the scheme.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build import SECTIONS, card_number  # noqa: PLC0415 - avoids a hard import at module load

    problems = []
    for section in SECTIONS:
        m = re.search(r'<section id="%s">(.*?)\n</section>' % section, html, re.S)
        if not m:
            problems.append(f"section #{section} is missing")
            continue
        nums = re.findall(r'<span class="proj-num">([^<]+)</span>', m.group(1))
        want = [card_number(section, i) for i in range(1, len(nums) + 1)]
        if nums != want:
            problems.append(f"#{section} card numbers are {nums}, expected {want}")
    return problems


def check_contents_matches_cards(html: str) -> list[str]:
    """Every card on the page must appear in the contents list, and vice versa."""
    cards = set(re.findall(r'<details class="proj-card" id="(proj-[^"]+)"', html))
    m = re.search(r"<!-- CONTENTS:START -->(.*?)<!-- CONTENTS:END -->", html, re.S)
    if not m:
        return ["contents block is missing"]
    listed = set(re.findall(r'href="#(proj-[^"]+)"', m.group(1)))
    problems = [f"{c} has a card but no contents entry" for c in sorted(cards - listed)]
    problems += [f"{c} is in the contents but has no card" for c in sorted(listed - cards)]
    return problems


def check_admin_rules_in_sync() -> list[str]:
    """The admin validates cards in JavaScript before committing them.

    That is a second copy of rules that live in build.py, so it can drift: add a
    block type to the build and the admin starts rejecting cards the site would
    render perfectly. Compare the lists rather than trust anyone to remember.
    """
    lib = ROOT / "api" / "_lib.js"
    if not lib.exists():
        return []  # admin not deployed in this checkout

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build import BADGE_KINDS, BLOCK_RENDERERS, EXPERIENCE_KINDS, SECTIONS  # noqa: PLC0415

    source = lib.read_text(encoding="utf-8")

    def js_list(name: str) -> set[str]:
        m = re.search(r"const %s = \[(.*?)\];" % re.escape(name), source, re.S)
        return set(re.findall(r"'([^']+)'", m.group(1))) if m else set()

    expected = {
        "SECTIONS": set(SECTIONS),
        "BADGE_KINDS": set(BADGE_KINDS),
        "BLOCK_TYPES": set(BLOCK_RENDERERS),
        "EXPERIENCE_KINDS": set(EXPERIENCE_KINDS),
    }

    problems = []
    for name, want in expected.items():
        got = js_list(name)
        if not got:
            problems.append(f"api/_lib.js: could not find {name}")
        elif got != want:
            missing = sorted(want - got)
            extra = sorted(got - want)
            detail = []
            if missing:
                detail.append(f"missing {missing}")
            if extra:
                detail.append(f"unknown {extra}")
            problems.append(f"api/_lib.js {name} out of sync with build.py: {', '.join(detail)}")
    return problems


def check_duplicate_ids(html: str) -> list[str]:
    ids = re.findall(r'\sid="([^"]+)"', html)
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    return [f'duplicate id="{d}"' for d in dupes]


def check_local_assets(html: str) -> list[str]:
    problems = []
    for ref in set(re.findall(r'(?:src|href)="((?!https?:|mailto:|#|//)[^"]+)"', html)):
        target = ROOT / ref.split("?", 1)[0].lstrip("/")
        if not target.exists():
            problems.append(f"missing local file: {ref}")
    return problems


def check_external_links(html: str) -> list[str]:
    """Network check. Off by default so the fast path stays offline."""
    import urllib.error
    import urllib.request

    problems = []
    # preconnect/dns-prefetch hrefs are origins, not pages: fonts.googleapis.com/ is a 404
    hinted = set(re.findall(r'<link[^>]+rel="(?:preconnect|dns-prefetch)"[^>]*href="([^"]+)"', html))
    hinted |= set(re.findall(r'<link[^>]+href="([^"]+)"[^>]*rel="(?:preconnect|dns-prefetch)"', html))
    urls = sorted({u for u in re.findall(r'href="(https?://[^"]+)"', html)} - hinted)
    for url in urls:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "portfolio-link-check"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status >= 400:
                    problems.append(f"{url} -> HTTP {r.status}")
        except urllib.error.HTTPError as e:
            # Some hosts refuse HEAD but serve GET fine
            if e.code in (403, 405):
                continue
            problems.append(f"{url} -> HTTP {e.code}")
        except Exception as e:  # noqa: BLE001 - a dead link is a dead link
            problems.append(f"{url} -> {type(e).__name__}: {e}")
    return problems


def run(check_links: bool = False) -> list[tuple[str, list[str]]]:
    html = INDEX.read_text(encoding="utf-8")
    checks = [
        ("tag balance", check_tag_balance(html)),
        ("anchor targets", check_anchors(html)),
        ("duplicate ids", check_duplicate_ids(html)),
        ("no inline handlers", check_no_inline_handlers(html)),
        ("JSON-LD", check_json_ld(html)),
        ("card numbering", check_card_numbering(html)),
        ("contents matches cards", check_contents_matches_cards(html)),
        ("local assets", check_local_assets(html)),
        ("admin rules in sync", check_admin_rules_in_sync()),
    ]
    if check_links:
        checks.append(("external links", check_external_links(html)))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="Structural checks on index.html")
    parser.add_argument("--links", action="store_true", help="also verify external URLs resolve")
    args = parser.parse_args()

    failed = 0
    for name, problems in run(args.links):
        if problems:
            failed += 1
            print(f"FAIL  {name}")
            for p in problems:
                print(f"        {p}")
        else:
            print(f"ok    {name}")

    if failed:
        print(f"\n{failed} check(s) failed", file=sys.stderr)
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
