"""
build.py
Renders every project card from content/projects/*.json into index.html.

The JSON files are the single source of truth for project cards. index.html holds
only the surrounding page; the card lists are regenerated between these markers:

    <!-- CARDS:START projects -->  ...  <!-- CARDS:END projects -->
    <!-- CARDS:START frontier -->  ...  <!-- CARDS:END frontier -->
    <!-- CARDS:START engineering -->  ...  <!-- CARDS:END engineering -->

Card numbers are derived, never hand-written: 01, 02, 03 in projects, R1, R2 in
frontier, E1, E2 in engineering, ordered by each card's "order" field. Adding a
project in the middle renumbers everything below it automatically.

Usage:
    python scripts/build.py            # rewrite index.html
    python scripts/build.py --check    # exit 1 if index.html is out of date

Note on escaping: JSON string values are emitted as HTML verbatim, so a value may
contain <code>, <strong>, &amp; and similar. This is authoring content committed
to this repo, never third-party input, so there is nothing to sanitize against.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content" / "projects"
INDEX = ROOT / "index.html"

# Every section on the page, in the order it appears. The index in this list is
# the section's number, so §1 is Quantitative Research. Sections that hold cards
# are the ones listed in SECTIONS below; the rest are static prose.
PAGE_SECTIONS = (
    ("projects", "Quantitative Research"),
    ("frontier", "Research"),
    ("engineering", "Engineering"),
    ("skills", "Skills"),
    ("education", "Education"),
    ("experience", "Experience"),
    ("blog", "Writing"),
    ("achievements", "Achievements"),
    ("contact", "Contact"),
)

SECTIONS = ("projects", "frontier", "engineering")
BADGE_KINDS = ("live", "progress", "research", "published", "freelance", "intern")
METRIC_TONES = ("pos", "neg", "flat", "amber")


class BuildError(Exception):
    """A card file is malformed. The message names the file and the field."""


# ── numbering ─────────────────────────────────────────────────────────────────

def section_number(section: str) -> int:
    for i, (name, _title) in enumerate(PAGE_SECTIONS, start=1):
        if name == section:
            return i
    raise BuildError(f"section {section!r} is not in PAGE_SECTIONS")


def card_number(section: str, position: int) -> str:
    """Cards are numbered like a paper: §2's third card is 2.3."""
    return f"{section_number(section)}.{position}"


# ── small helpers ─────────────────────────────────────────────────────────────

def split_tone(value: str, allowed: tuple[str, ...]) -> tuple[str, str]:
    """"1.02|pos" -> ("1.02", "pos"). A bare value has no tone."""
    text, _, tone = value.partition("|")
    if tone and tone not in allowed:
        raise BuildError(f"unknown tone {tone!r}, expected one of {allowed}")
    return text, tone


def cls(*names: str) -> str:
    """Join class names, dropping empties, as a ready-to-emit attribute value."""
    return " ".join(n for n in names if n)


# ── block renderers ───────────────────────────────────────────────────────────

def render_text(block: dict) -> str:
    paras = "\n".join(f"              <p>{p}</p>" for p in block["paras"])
    return (
        f'          <div class="detail-block">\n'
        f'            <div class="detail-h">{block["h"]}</div>\n'
        f'            <div class="detail-text">\n{paras}\n'
        f'            </div>\n'
        f'          </div>'
    )


def render_bullets(block: dict) -> str:
    items = "\n".join(f"              <li>{i}</li>" for i in block["items"])
    return (
        f'          <div class="detail-block">\n'
        f'            <div class="detail-h">{block["h"]}</div>\n'
        f'            <ul class="detail-bullets">\n{items}\n'
        f'            </ul>\n'
        f'          </div>'
    )


def render_flow(nodes: list[str], indent: str, first: bool) -> str:
    """A row of architecture boxes.

    Shorthand per entry:
        "Label|small text"   a normal box
        "*Label|small text"  a highlighted (key) box
        "->"                 an arrow
        "+"                  a plus, for parallel inputs merging
    """
    style = "" if first else ' style="margin-top:8px"'
    out = [f'{indent}<div class="arch-flow"{style}>']
    for node in nodes:
        if node == "->":
            out.append(f'{indent}  <span class="arch-arr">→</span>')
        elif node == "+":
            out.append(f'{indent}  <span class="arch-plus">+</span>')
        else:
            key = node.startswith("*")
            label, _, sub = node.lstrip("*").partition("|")
            small = f"<br><small>{sub}</small>" if sub else ""
            out.append(f'{indent}  <div class="{cls("arch-node", "key" if key else "")}">{label}{small}</div>')
    out.append(f"{indent}</div>")
    return "\n".join(out)


def render_note(text: str, indent: str) -> str:
    lines = "\n".join(f"{indent}  {line}" for line in text.strip().split("\n"))
    return f'{indent}<div class="arch-note">\n{lines}\n{indent}</div>'


def render_arch(block: dict) -> str:
    flows = block.get("flows") or [block["flow"]]
    body = "\n".join(render_flow(f, "              ", i == 0) for i, f in enumerate(flows))
    note = "\n" + render_note(block["note"], "              ") if block.get("note") else ""
    return (
        f'          <div class="detail-block">\n'
        f'            <div class="detail-h">{block["h"]}</div>\n'
        f'            <div class="arch-diagram">\n{body}{note}\n'
        f'            </div>\n'
        f'          </div>'
    )


def render_table(block: dict) -> str:
    head = "".join(f"<th>{c}</th>" for c in block["cols"])
    rows = []
    for row in block["rows"]:
        hi = row[0].startswith("*")
        cells = [row[0].lstrip("*")] + list(row[1:])
        tds = []
        for cell in cells:
            text, tone = split_tone(cell, METRIC_TONES)
            tds.append(f'<td class="{tone}">{text}</td>' if tone else f"<td>{text}</td>")
        row_cls = ' class="hi"' if hi else ""
        rows.append(f'                  <tr{row_cls}>{"".join(tds)}</tr>')
    caption = f'\n                <caption>{block["caption"]}</caption>' if block.get("caption") else ""
    note = "\n" + render_note(block["note"], "            ") if block.get("note") else ""
    return (
        f'          <div class="detail-block">\n'
        f'            <div class="detail-h">{block["h"]}</div>\n'
        f'            <div class="perf-wrap">\n'
        f'              <table class="perf-table">{caption}\n'
        f'                <thead><tr>{head}</tr></thead>\n'
        f'                <tbody>\n' + "\n".join(rows) + "\n"
        f'                </tbody>\n'
        f'              </table>\n'
        f'            </div>{note}\n'
        f'          </div>'
    )


def render_nulls(block: dict) -> str:
    """A red-ruled callout. Takes bullets, prose, or both."""
    parts = []
    if block.get("items"):
        lis = "\n".join(f"                <li>{i}</li>" for i in block["items"])
        parts.append(f'              <ul class="detail-bullets">\n{lis}\n              </ul>')
    if block.get("after"):
        # the gap is only needed when prose follows a list
        style = ' style="margin-top:14px"' if block.get("items") else ""
        ps = "\n".join(f"                <p>{p}</p>" for p in block["after"])
        parts.append(f'              <div class="detail-text"{style}>\n{ps}\n              </div>')
    if not parts:
        raise BuildError(f'nulls block {block["h"]!r} has neither "items" nor "after"')
    return (
        f'          <div class="detail-block">\n'
        f'            <div class="detail-h">{block["h"]}</div>\n'
        f'            <div class="null-box">\n'
        f'              <div class="nb-label">{block["label"]}</div>\n'
        + "\n".join(parts) + "\n"
        f'            </div>\n'
        f'          </div>'
    )


def render_html(block: dict) -> str:
    """Escape hatch for a one-off block the schema does not cover."""
    return (
        f'          <div class="detail-block">\n'
        f'            <div class="detail-h">{block["h"]}</div>\n'
        f'{block["raw"]}\n'
        f'          </div>'
    )


BLOCK_RENDERERS = {
    "text": render_text,
    "bullets": render_bullets,
    "arch": render_arch,
    "table": render_table,
    "nulls": render_nulls,
    "html": render_html,
}


# ── sidebar renderers ─────────────────────────────────────────────────────────

def render_sidebar_block(block: dict) -> str:
    kind = block["type"]
    head = (
        f'          <div class="sidebar-block">\n'
        f'            <div class="sb-label">{block["label"]}</div>\n'
    )

    if kind == "tags":
        chips = [f'<span class="tag">{t}</span>' for t in block["items"]]
        lines = ["".join(chips[i:i + 2]) for i in range(0, len(chips), 2)]
        body = "\n".join(f"              {ln}" for ln in lines)
        return head + f'            <div class="sb-tags">\n{body}\n            </div>\n          </div>'

    if kind == "metrics":
        rows = []
        for item in block["items"]:
            label, value = item[0], item[1]
            tone = item[2] if len(item) > 2 else ""
            if tone and tone not in METRIC_TONES:
                raise BuildError(f"unknown metric tone {tone!r} on {label!r}")
            rows.append(
                f'              <div class="metric-row">'
                f'<span class="metric-label">{label}</span>'
                f'<span class="{cls("metric-val", tone)}">{value}</span></div>'
            )
        return head + '            <div class="sb-metrics">\n' + "\n".join(rows) + "\n            </div>\n          </div>"

    if kind == "links":
        rows = [
            f'            <a href="{url}" target="_blank" rel="noopener" class="sb-link">{text} <span>↗</span></a>'
            for text, url in block["items"]
        ]
        return head + "\n".join(rows) + "\n          </div>"

    raise BuildError(f"unknown sidebar block type {kind!r}")


# ── whole card ────────────────────────────────────────────────────────────────

def render_card(card: dict, number: str) -> str:
    badge = ""
    if card.get("badge"):
        kind = card["badge"]["kind"]
        if kind not in BADGE_KINDS:
            raise BuildError(f"unknown badge kind {kind!r}, expected one of {BADGE_KINDS}")
        badge = f'\n              <span class="badge {kind}">{card["badge"]["text"]}</span>'

    chips = [f'<span class="tag">{t}</span>' for t in card["tags"]]
    tag_lines = "\n".join(
        f"              {''.join(chips[i:i + 2])}" for i in range(0, len(chips), 2)
    )

    blocks = []
    for block in card["blocks"]:
        renderer = BLOCK_RENDERERS.get(block["type"])
        if renderer is None:
            raise BuildError(f"unknown block type {block['type']!r}")
        blocks.append(renderer(block))

    sidebar = "\n".join(render_sidebar_block(b) for b in card["sidebar"])

    return f"""    <details class="proj-card" id="proj-{card['id']}">
      <summary class="proj-summary">
        <div class="ps-left">
          <span class="proj-num">{number}</span>
          <div class="proj-info">
            <div class="proj-title-row">
              <span class="proj-name" role="heading" aria-level="3">{card['name']}</span>{badge}
            </div>
            <p class="proj-tagline">{card['tagline']}</p>
            <div class="proj-tags">
{tag_lines}
            </div>
          </div>
        </div>
        <span class="expand-label">
          <span class="close-text">View details ↓</span>
          <span class="open-text">Close ↑</span>
        </span>
      </summary>

      <div class="proj-detail">
        <div>
{chr(10).join(blocks)}
        </div>

        <div class="detail-sidebar">
{sidebar}
        </div>
      </div>
    </details>"""


# ── loading and validation ────────────────────────────────────────────────────

def load_cards() -> dict[str, list[dict]]:
    if not CONTENT.is_dir():
        raise BuildError(f"no content directory at {CONTENT}")

    by_section: dict[str, list[dict]] = {s: [] for s in SECTIONS}
    seen_ids: dict[str, Path] = {}

    for path in sorted(CONTENT.glob("*.json")):
        if path.name.startswith("_"):
            continue  # _TEMPLATE.json and friends
        try:
            card = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise BuildError(f"{path.name}: invalid JSON, {e}") from e

        for field in ("section", "order", "id", "name", "tagline", "tags", "blocks", "sidebar"):
            if field not in card:
                raise BuildError(f"{path.name}: missing required field {field!r}")
        if card["section"] not in SECTIONS:
            raise BuildError(f"{path.name}: section must be one of {SECTIONS}")
        if card["id"] in seen_ids:
            raise BuildError(f"{path.name}: duplicate id {card['id']!r}, already used by {seen_ids[card['id']].name}")

        seen_ids[card["id"]] = path
        card["_file"] = path.name
        by_section[card["section"]].append(card)

    for section, cards in by_section.items():
        cards.sort(key=lambda c: (c["order"], c["_file"]))
        orders = [c["order"] for c in cards]
        if len(set(orders)) != len(orders):
            dupes = sorted({o for o in orders if orders.count(o) > 1})
            raise BuildError(f"section {section!r}: duplicate order values {dupes}")

    return by_section


def render_section(cards: list[dict]) -> str:
    return "\n\n".join(render_card(c, card_number(c["section"], i + 1)) for i, c in enumerate(cards))


# ── table of contents ─────────────────────────────────────────────────────────

def render_contents(by_section: dict[str, list[dict]]) -> str:
    """The contents list on the first screen.

    Generated from the same card files as the cards themselves, so the two can
    never drift. Sections without cards still get a line, because the point of
    the list is to show the shape of the whole page without scrolling.
    """
    out = []
    for index, (section, title) in enumerate(PAGE_SECTIONS, start=1):
        out.append(
            f'        <li class="toc-section">\n'
            f'          <a href="#{section}">'
            f'<span class="toc-num">{index}</span>'
            f'<span class="toc-title">{title}</span></a>'
        )
        cards = by_section.get(section, [])
        if cards:
            out.append('          <ul class="toc-cards">')
            for position, card in enumerate(cards, start=1):
                lede = card.get("lede", "")
                leader = f'<span class="toc-lede">{lede}</span>' if lede else ""
                out.append(
                    f'            <li><a href="#proj-{card["id"]}">'
                    f'<span class="toc-num">{card_number(section, position)}</span>'
                    f'<span class="toc-name">{card["name"]}</span>{leader}</a></li>'
                )
            out.append("          </ul>")
        out.append("        </li>")
    return "\n".join(out)


def apply_to_index(html: str, by_section: dict[str, list[dict]]) -> str:
    for section in SECTIONS:
        start = f"<!-- CARDS:START {section} -->"
        end = f"<!-- CARDS:END {section} -->"
        pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
        if not pattern.search(html):
            raise BuildError(f"markers for section {section!r} not found in index.html")
        body = render_section(by_section[section])
        replacement = f"{start}\n{body}\n    {end}" if body else f"{start}\n    {end}"
        html = pattern.sub(lambda _m: replacement, html, count=1)

    start, end = "<!-- CONTENTS:START -->", "<!-- CONTENTS:END -->"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(html):
        raise BuildError("contents markers not found in index.html")
    contents = render_contents(by_section)
    html = pattern.sub(lambda _m: f"{start}\n{contents}\n      {end}", html, count=1)

    return html


def main() -> int:
    parser = argparse.ArgumentParser(description="Render project cards into index.html")
    parser.add_argument("--check", action="store_true",
                        help="do not write; exit 1 if index.html is out of date")
    args = parser.parse_args()

    try:
        by_section = load_cards()
        current = INDEX.read_text(encoding="utf-8")
        rebuilt = apply_to_index(current, by_section)
    except BuildError as e:
        print(f"build failed: {e}", file=sys.stderr)
        return 1

    counts = " | ".join(f"{s} {len(by_section[s])}" for s in SECTIONS)
    total = sum(len(v) for v in by_section.values())

    if args.check:
        if rebuilt != current:
            print("index.html is out of date, run: python scripts/build.py", file=sys.stderr)
            return 1
        print(f"index.html up to date ({total} cards: {counts})")
        return 0

    if rebuilt == current:
        print(f"no change ({total} cards: {counts})")
        return 0

    INDEX.write_text(rebuilt, encoding="utf-8", newline="")
    print(f"rebuilt {total} cards -> index.html")
    print(f"  {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
