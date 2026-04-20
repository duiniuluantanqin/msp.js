#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/deploy.sh patch                  # 1.0.0 -> 1.0.1, push to origin
#   ./scripts/deploy.sh minor upstream         # 1.0.0 -> 1.1.0, push to upstream
#   ./scripts/deploy.sh major --remote mirror  # 1.0.0 -> 2.0.0, push to mirror
#   ./scripts/deploy.sh 1.2.3                  # explicit version

BUMP=${1:-patch}
REMOTE=${2:-origin}

if [[ "$REMOTE" == "--remote" ]]; then
  REMOTE=${3:-}
fi

if [[ "$BUMP" == "--remote" ]]; then
  REMOTE=${2:-}
  BUMP=patch
fi

if [[ -z "$REMOTE" ]]; then
  echo "❌  Missing remote name. Use ./scripts/deploy.sh [major|minor|patch|x.y.z] [remote]" >&2
  exit 1
fi

# ── Sanity checks ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌  node is required" >&2; exit 1
fi

if ! git remote get-url "$REMOTE" &>/dev/null; then
  echo "❌  Git remote '$REMOTE' does not exist" >&2
  git remote >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌  Working tree is dirty. Commit or stash changes first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  echo "⚠️  You are on branch '$CURRENT_BRANCH', not main/master."
  read -r -p "Continue anyway? [y/N] " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || exit 0
fi

# ── Bump version ─────────────────────────────────────────────────────────────
CURRENT_VERSION=$(node -p "require('./package.json').version")

if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION="$BUMP"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  case "$BUMP" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *)
      echo "❌  Unknown bump type '$BUMP'. Use major / minor / patch / x.y.z" >&2
      exit 1
      ;;
  esac
fi

echo "📦  $CURRENT_VERSION  →  $NEW_VERSION"
echo "🚀  Push remote: $REMOTE"
read -r -p "Proceed? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || exit 0

# ── Update package.json ───────────────────────────────────────────────────────
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# ── Commit, tag, push ─────────────────────────────────────────────────────────
TAG="v${NEW_VERSION}"

git add package.json
git commit -m "chore: release ${TAG}"
git tag "$TAG"
git push "$REMOTE" "$CURRENT_BRANCH"
git push "$REMOTE" "$TAG"

echo "✅  Released ${TAG} — GitHub Actions will publish to npm."
