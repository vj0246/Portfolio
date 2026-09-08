"""
publish.py
Build the cards, validate the result, show what changed, ask once, then ship.

    python scripts/publish.py                  # build, check, diff, confirm, push
    python scripts/publish.py --links          # also verify every external URL first
    python scripts/publish.py -m "message"     # override the generated commit message
    python scripts/publish.py --dry-run        # do everything except commit and push

Pushing to main triggers a Vercel redeploy, so the confirmation is the last point
at which a bad card can be stopped. Nothing here force-pushes or rewrites history;
if the rebase hits a conflict the script stops and leaves it for you to resolve.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"


def git(*args: str, capture: bool = True, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, text=True,
        capture_output=capture, encoding="utf-8", errors="replace",
    )
    if check and result.returncode != 0:
        sys.stderr.write((result.stderr or result.stdout or "").strip() + "\n")
        raise SystemExit(f"git {' '.join(args)} failed with exit code {result.returncode}")
    return (result.stdout or "").strip()


def run_step(label: str, *args: str) -> None:
    print(f"\n>> {label}")
    result = subprocess.run([sys.executable, *args], cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"{label} failed, nothing was committed")


def commit_message(changed: list[str]) -> str:
    """Conventional commit, inferred from which files moved."""
    cards = [f for f in changed if f.startswith("content/projects/")]
    added = [f for f in git("diff", "--cached", "--name-only", "--diff-filter=A").splitlines()
             if f.startswith("content/projects/")]

    if added:
        names = [Path(f).stem.split("-", 2)[-1] for f in added]
        return f"feat(projects): add {', '.join(names)} card" + ("s" if len(names) > 1 else "")
    if cards:
        names = [Path(f).stem.split("-", 2)[-1] for f in cards]
        return f"content(projects): update {', '.join(sorted(set(names)))}"
    if any(f.endswith((".css",)) for f in changed):
        return "style(site): update styling"
    if any(f.startswith("scripts/") or f.startswith("js/") for f in changed):
        return "chore(site): update tooling"
    return "chore(site): update content"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build, validate, and publish the portfolio")
    parser.add_argument("-m", "--message", help="commit message, overrides the generated one")
    parser.add_argument("--links", action="store_true", help="verify external URLs before publishing")
    parser.add_argument("--dry-run", action="store_true", help="stop before committing")
    args = parser.parse_args()

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch != "main":
        print(f"on branch {branch!r}, not main. Switch first, or push it yourself.", file=sys.stderr)
        return 1

    run_step("building cards", str(SCRIPTS / "build.py"))
    validate = [str(SCRIPTS / "validate.py")] + (["--links"] if args.links else [])
    run_step("validating", *validate)

    changed = git("status", "--porcelain").splitlines()
    if not changed:
        print("\nnothing to publish, working tree is clean")
        return 0

    print("\n>> changes")
    print(git("diff", "--stat", "HEAD") or "  (staged only)")
    print(git("status", "--short"))

    if args.dry_run:
        print("\ndry run, stopping before commit")
        return 0

    answer = input("\npublish these to main? [y/N] ").strip().lower()
    if answer not in ("y", "yes"):
        print("cancelled, nothing was committed")
        return 0

    git("add", "-A")
    message = args.message or commit_message([line[3:] for line in changed])
    print(f"\n>> commit: {message}")
    git("commit", "-m", message)

    # CI commits the refreshed GitHub data back to main, so always rebase first.
    print(">> pull --rebase")
    result = subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=ROOT, text=True)
    if result.returncode != 0:
        print(
            "\nrebase stopped. Your commit is safe on this branch.\n"
            "Resolve the conflict, run: git rebase --continue, then: git push",
            file=sys.stderr,
        )
        return 1

    print(">> push")
    git("push", "origin", "main", capture=False)
    print("\npushed. Vercel redeploys in about 30 seconds.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
