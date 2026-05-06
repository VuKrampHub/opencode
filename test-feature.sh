#!/usr/bin/env bash
# test-feature.sh
# Sets up and runs the "Create Folder" feature branch locally for manual testing.
# Requirements: bun 1.2+, git

set -euo pipefail

REPO="https://github.com/VuKrampHub/opencode.git"
BRANCH="feat/create-folder-button"
DIR="opencode-create-folder-test"
SERVER_PORT=4096
APP_PORT=5173

# ── colours ────────────────────────────────────────────────────────────────────
bold=$'\e[1m'; reset=$'\e[0m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'
info()  { echo "${bold}${green}==>${reset} $*"; }
warn()  { echo "${bold}${yellow}-->${reset} $*"; }
die()   { echo "${bold}${red}ERR${reset} $*" >&2; exit 1; }

# ── preflight ──────────────────────────────────────────────────────────────────
command -v bun  >/dev/null 2>&1 || die "bun not found. Install from https://bun.sh"
command -v git  >/dev/null 2>&1 || die "git not found."

BUN_VERSION=$(bun --version)
info "bun $BUN_VERSION detected"

# ── clone ──────────────────────────────────────────────────────────────────────
if [[ -d "$DIR" ]]; then
  warn "Directory '$DIR' already exists — pulling latest instead of cloning"
  git -C "$DIR" fetch origin
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  info "Cloning $BRANCH from $REPO …"
  git clone --branch "$BRANCH" --single-branch "$REPO" "$DIR"
fi

cd "$DIR"
info "Checked out: $(git log --oneline -1)"

# ── install ────────────────────────────────────────────────────────────────────
info "Installing dependencies (this may take a minute) …"
bun install --ignore-scripts

# ── explain what we changed ────────────────────────────────────────────────────
echo ""
echo "${bold}── What this branch adds ──────────────────────────────────────${reset}"
echo "  Backend  POST /file/mkdir in packages/opencode/src/server/routes/instance/file.ts"
echo "           File.mkdir() method in packages/opencode/src/file/index.ts"
echo "  SDK      File.mkdir() in packages/sdk/js/src/v2/gen/sdk.gen.ts"
echo "  Frontend DialogCreateFolder component  packages/app/src/components/dialog-create-folder.tsx"
echo "           'New Folder' button on homepage (home.tsx)"
echo "           Command palette entry Mod+Shift+N (layout.tsx)"
echo ""

# ── start server ───────────────────────────────────────────────────────────────
SERVER_LOG=$(mktemp /tmp/opencode-server-XXXX.log)
info "Starting OpenCode server on port $SERVER_PORT …"
info "Server log → $SERVER_LOG"

bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port "$SERVER_PORT" \
  >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "  Server PID: $SERVER_PID"

# wait up to 10 s for the server to be ready
for i in $(seq 1 20); do
  sleep 0.5
  if curl -sf "http://localhost:$SERVER_PORT/global/health" >/dev/null 2>&1; then
    info "Server is up (http://localhost:$SERVER_PORT)"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    warn "Server process exited early. Last log lines:"
    tail -20 "$SERVER_LOG"
    die "Server failed to start — see $SERVER_LOG"
  fi
done

if ! curl -sf "http://localhost:$SERVER_PORT/global/health" >/dev/null 2>&1; then
  warn "Server health check timed out. Last log lines:"
  tail -20 "$SERVER_LOG"
  die "Server didn't become healthy — see $SERVER_LOG"
fi

# ── quick API smoke test ───────────────────────────────────────────────────────
info "Smoke-testing POST /file/mkdir …"
TEST_DIR="/tmp/opencode-mkdir-test-$$"
RESPONSE=$(curl -sf -X POST \
  "http://localhost:$SERVER_PORT/file/mkdir?directory=$HOME" \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"$TEST_DIR\"}" 2>&1) || true

if echo "$RESPONSE" | grep -q '"path"'; then
  CREATED=$(echo "$RESPONSE" | grep -o '"path":"[^"]*"' | cut -d'"' -f4)
  if [[ -d "$CREATED" ]]; then
    info "POST /file/mkdir → created $CREATED  ✓"
    rmdir "$CREATED"
  else
    warn "API returned path but directory not found on disk: $CREATED"
  fi
else
  warn "Unexpected response from /file/mkdir: $RESPONSE"
  warn "The endpoint may need the server to initialise the directory instance first."
fi

# ── start web app ─────────────────────────────────────────────────────────────
echo ""
info "Starting web app dev server …"
echo ""
echo "${bold}── How to test ────────────────────────────────────────────────${reset}"
echo "  1. Open http://localhost:$APP_PORT in your browser"
echo "  2. The homepage should show a 'New Folder' button beside 'Open Project'"
echo "  3. Click 'New Folder' — enter a parent path and folder name, press Enter"
echo "  4. The folder should be created on disk and immediately opened as a project"
echo "  5. Mod+Shift+N (Ctrl+Shift+N on Windows/Linux) also opens the dialog"
echo ""
echo "  Press Ctrl+C to stop everything."
echo "${bold}───────────────────────────────────────────────────────────────${reset}"
echo ""

# kill server when this script exits
trap "kill $SERVER_PID 2>/dev/null; info 'Server stopped.'" EXIT

bun run --cwd packages/app dev --port "$APP_PORT"
