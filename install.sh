#!/usr/bin/env bash
# Claw Studio installer
# Usage: curl -fsSL https://raw.githubusercontent.com/perweum/claw-studio/main/install.sh | bash

set -euo pipefail

CLAW_REPO="https://github.com/perweum/claw-studio.git"
NANOCLAW_REPO="https://github.com/nanoclaw-ai/nanoclaw.git"
NANOCLAW_DIR="$HOME/nanoclaw"
STUDIO_DIR=""   # resolved below

# ── Colours ───────────────────────────────────────────────────────────────────
bold=$(tput bold 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
yellow=$(tput setaf 3 2>/dev/null || true)
red=$(tput setaf 1 2>/dev/null || true)
blue=$(tput setaf 4 2>/dev/null || true)

step()  { echo "${bold}${blue}==>${reset}${bold} $*${reset}"; }
ok()    { echo "${green}  ✓${reset} $*"; }
warn()  { echo "${yellow}  !${reset} $*"; }
die()   { echo "${red}  ✗${reset} $*" >&2; exit 1; }

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo "${bold}◈ Claw Studio${reset} — installer"
echo "────────────────────────────────"
echo ""

# ── macOS check ───────────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  die "This installer currently supports macOS only."
fi

# ── Homebrew ──────────────────────────────────────────────────────────────────
step "Checking Homebrew"
if ! command -v brew &>/dev/null; then
  warn "Homebrew not found — installing it now."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this session (Apple Silicon path)
  [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
else
  ok "Homebrew $(brew --version | head -1)"
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
step "Checking Node.js"
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing via Homebrew."
  brew install node
else
  NODE_VER=$(node --version | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -lt 18 ]]; then
    warn "Node.js $NODE_VER is too old (need 18+) — upgrading."
    brew upgrade node || brew install node
  else
    ok "Node.js v$NODE_VER"
  fi
fi

# ── Git ───────────────────────────────────────────────────────────────────────
step "Checking git"
if ! command -v git &>/dev/null; then
  warn "git not found — installing via Homebrew."
  brew install git
else
  ok "git $(git --version | awk '{print $3}')"
fi

# ── Container runtime ─────────────────────────────────────────────────────────
step "Checking container runtime"

HAS_APPLE=false
HAS_DOCKER=false
CHOSEN_RUNTIME=""

command -v container &>/dev/null && HAS_APPLE=true
command -v docker &>/dev/null && docker info &>/dev/null 2>&1 && HAS_DOCKER=true

if $HAS_APPLE && $HAS_DOCKER; then
  # Both available — ask which to use
  echo ""
  echo "  Both Apple Container and Docker are installed."
  echo "  Which one should nanoclaw use?"
  echo ""
  echo "  ${bold}1)${reset} Apple Container  — native macOS, lightweight, no background daemon"
  echo "  ${bold}2)${reset} Docker           — widely compatible, works on any macOS version"
  echo ""
  read -r -p "  Choose [1/2]: " choice
  if [[ "$choice" == "2" ]]; then
    CHOSEN_RUNTIME="docker"
    ok "Using Docker"
  else
    CHOSEN_RUNTIME="apple"
    ok "Using Apple Container"
  fi

elif $HAS_APPLE; then
  CHOSEN_RUNTIME="apple"
  ok "Apple Container found — using it"

elif $HAS_DOCKER; then
  CHOSEN_RUNTIME="docker"
  ok "Docker found and running — using it"

else
  # Nothing installed — ask which to install
  echo ""
  echo "  nanoclaw runs agents inside containers. Nothing is installed yet."
  echo "  Which container runtime would you like to use?"
  echo ""
  echo "  ${bold}1)${reset} Apple Container  — native macOS, lightweight, no background daemon"
  echo "                     Requires macOS 26 (Tahoe) or later"
  echo "  ${bold}2)${reset} Docker Desktop   — works on any macOS version, installs via Homebrew"
  echo "                     Free for personal use"
  echo ""
  read -r -p "  Choose [1/2]: " choice

  if [[ "$choice" == "1" ]]; then
    CHOSEN_RUNTIME="apple"
    # Check macOS version
    MACOS_VER=$(sw_vers -productVersion | cut -d. -f1)
    if [[ "$MACOS_VER" -lt 26 ]]; then
      warn "Apple Container requires macOS 26 (Tahoe) or later. You have macOS $MACOS_VER."
      echo ""
      echo "  Options:"
      echo "  • Upgrade to macOS 26, then re-run this installer"
      echo "  • Choose Docker instead (press Enter to switch)"
      echo ""
      read -r -p "  Switch to Docker? [Y/n] " yn
      yn="${yn:-y}"
      if [[ "$yn" =~ ^[Yy]$ ]]; then
        CHOSEN_RUNTIME="docker"
      else
        die "Apple Container not available on this macOS version. Re-run after upgrading."
      fi
    fi
    if [[ "$CHOSEN_RUNTIME" == "apple" ]]; then
      if ! command -v container &>/dev/null; then
        echo ""
        echo "  Apple Container is part of macOS 26."
        echo "  If it's not available yet, enable it via:"
        echo "  System Settings → Developer Tools → Container"
        echo ""
        read -r -p "  Press Enter once Apple Container is enabled, or Ctrl+C to cancel..."
        command -v container &>/dev/null || die "Apple Container still not found. Enable it and re-run."
      fi
      ok "Apple Container ready"
    fi
  else
    CHOSEN_RUNTIME="docker"
  fi

  if [[ "$CHOSEN_RUNTIME" == "docker" ]]; then
    if ! command -v docker &>/dev/null; then
      step "Installing Docker Desktop via Homebrew"
      brew install --cask docker
      ok "Docker Desktop installed"
      echo ""
      echo "  ${yellow}!${reset} Docker Desktop needs to start once before it's usable."
      echo "    Opening Docker now — wait for the whale icon to appear in your menu bar,"
      echo "    then press Enter to continue."
      echo ""
      open -a Docker
      read -r -p "  Press Enter when Docker is running..."
    fi
    # Verify Docker is now running
    docker info &>/dev/null 2>&1 || die "Docker doesn't seem to be running. Start Docker Desktop and re-run."
    ok "Docker running"
  fi
fi

# ── nanoclaw ──────────────────────────────────────────────────────────────────
step "Checking nanoclaw"

# Try to find an existing nanoclaw install
found_nanoclaw=""

# 1. Check the default location
if [[ -d "$NANOCLAW_DIR/groups" ]] && [[ -d "$NANOCLAW_DIR/src" || -d "$NANOCLAW_DIR/store" ]]; then
  found_nanoclaw="$NANOCLAW_DIR"
fi

# 2. Check if we're running from inside a nanoclaw dir
if [[ -z "$found_nanoclaw" ]]; then
  check="$PWD"
  for _ in 1 2 3 4 5; do
    if [[ -d "$check/groups" ]] && [[ -d "$check/src" || -d "$check/store" ]]; then
      found_nanoclaw="$check"
      break
    fi
    check="$(dirname "$check")"
  done
fi

if [[ -n "$found_nanoclaw" ]]; then
  ok "Found existing nanoclaw at $found_nanoclaw"
  NANOCLAW_DIR="$found_nanoclaw"
  step "Installing nanoclaw dependencies"
  (cd "$NANOCLAW_DIR" && npm install --silent)
  ok "Dependencies up to date"
else
  warn "nanoclaw not found — cloning to $NANOCLAW_DIR"
  git clone --depth=1 "$NANOCLAW_REPO" "$NANOCLAW_DIR"
  ok "Cloned nanoclaw"
  step "Installing nanoclaw dependencies"
  (cd "$NANOCLAW_DIR" && npm install --silent)
  ok "Dependencies installed"

  # Write container runtime choice to nanoclaw's .env
  NANOCLAW_ENV="$NANOCLAW_DIR/.env"
  if [[ "$CHOSEN_RUNTIME" == "apple" ]]; then
    grep -q "^CONTAINER_RUNTIME=" "$NANOCLAW_ENV" 2>/dev/null \
      && sed -i '' 's/^CONTAINER_RUNTIME=.*/CONTAINER_RUNTIME=apple/' "$NANOCLAW_ENV" \
      || echo "CONTAINER_RUNTIME=apple" >> "$NANOCLAW_ENV"
    ok "Container runtime set to Apple Container in nanoclaw/.env"
  fi
  # (docker is the nanoclaw default — no need to write it unless overriding apple)

  # Build the agent container
  step "Building agent container (this takes a minute)"
  if [[ -f "$NANOCLAW_DIR/container/build.sh" ]]; then
    (cd "$NANOCLAW_DIR" && bash container/build.sh)
    ok "Container built"
  else
    warn "container/build.sh not found — skipping container build"
  fi
fi

# ── Claw Studio ───────────────────────────────────────────────────────────────
step "Checking Claw Studio"

PROJECTS_DIR="$NANOCLAW_DIR/Projects"
mkdir -p "$PROJECTS_DIR"
STUDIO_DIR="$PROJECTS_DIR/Claw Studio"

if [[ -d "$STUDIO_DIR/.git" ]]; then
  ok "Claw Studio already installed at $STUDIO_DIR"
  step "Pulling latest updates"
  (cd "$STUDIO_DIR" && git pull --ff-only --quiet)
  ok "Up to date"
else
  git clone --depth=1 "$CLAW_REPO" "$STUDIO_DIR"
  ok "Cloned Claw Studio"
fi

step "Installing Claw Studio dependencies"
(cd "$STUDIO_DIR" && npm install --silent)
ok "Dependencies installed"

# ── launchd service for nanoclaw ──────────────────────────────────────────────
step "Setting up nanoclaw background service"

PLIST_DST="$HOME/Library/LaunchAgents/com.nanoclaw.plist"
PLIST_SRC="$NANOCLAW_DIR/com.nanoclaw.plist"

if [[ ! -f "$PLIST_SRC" ]]; then
  warn "com.nanoclaw.plist not found in nanoclaw directory — skipping service setup"
else
  cp "$PLIST_SRC" "$PLIST_DST"
  # Load (or restart if already loaded)
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  launchctl load "$PLIST_DST"
  ok "nanoclaw service installed and started"
fi

# ── Create macOS app (no quarantine — assembled locally from repo) ────────────
step "Creating Claw Studio app"

APP_TEMPLATE="$STUDIO_DIR/macos-app/Claw Studio.app"

# Prefer ~/Applications (no sudo needed); fall back to /Applications if it
# is writable (e.g. the user already owns it or runs as admin).
if [[ -w "/Applications" ]]; then
  APP_DST="/Applications/Claw Studio.app"
else
  mkdir -p "$HOME/Applications"
  APP_DST="$HOME/Applications/Claw Studio.app"
  warn "No write access to /Applications — installing to ~/Applications instead (still shows in Launchpad & Spotlight)"
fi

# Remove any existing copy
rm -rf "$APP_DST"

# Copy the .app structure from the repo.
# Files assembled locally (not downloaded directly) don't get macOS quarantine.
cp -R "$APP_TEMPLATE" "$APP_DST"

# Write a customized launch script with the exact paths for this machine.
# Supports nvm, Homebrew node, and system node — whichever is present.
cat > "$APP_DST/Contents/MacOS/launch" << LAUNCHEOF
#!/usr/bin/env bash
# Claw Studio launcher — generated by install.sh

LOG="\$HOME/Library/Logs/claw-studio.log"
exec > "\$LOG" 2>&1
echo "=== Claw Studio starting \$(date) ==="

# Load nvm if available
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && source "\$NVM_DIR/nvm.sh" --no-use

# Build PATH with all common node locations
NVM_NODE_BIN="\$NVM_DIR/versions/node/\$(ls \$NVM_DIR/versions/node 2>/dev/null | sort -V | tail -1)/bin"
export PATH="\$NVM_NODE_BIN:/opt/homebrew/bin:/usr/local/bin:\$PATH"

# Verify npm is available — show a clear error if not
NPM_BIN="\$(command -v npm 2>/dev/null)"
if [[ -z "\$NPM_BIN" ]]; then
  osascript -e 'display dialog "Claw Studio could not find Node.js / npm.\n\nFix: open Terminal and run:\n  brew install node\n\nThen restart Claw Studio." buttons {"OK"} default button "OK" with icon stop'
  exit 1
fi
echo "Using npm: \$NPM_BIN"

STUDIO_DIR="$STUDIO_DIR"
cd "\$STUDIO_DIR" || { osascript -e "display dialog \"Claw Studio folder not found:\n\$STUDIO_DIR\" buttons {\"OK\"} default button \"OK\" with icon stop"; exit 1; }

# Kill any stale server on port 5275
lsof -ti TCP:5275 2>/dev/null | xargs kill -9 2>/dev/null || true

# Start the dev server
"\$NPM_BIN" run dev &
SERVER_PID=\$!

# Wait up to 30s for the server to be ready
for i in \$(seq 1 60); do
  sleep 0.5
  lsof -i TCP:5275 -sTCP:LISTEN -P -n 2>/dev/null | grep -q LISTEN && break
done

# Check it actually started before opening the browser
if ! lsof -i TCP:5275 -sTCP:LISTEN -P -n 2>/dev/null | grep -q LISTEN; then
  osascript -e "display dialog \"Claw Studio failed to start.\n\nCheck the log for details:\n\$LOG\" buttons {\"OK\"} default button \"OK\" with icon stop"
  kill "\$SERVER_PID" 2>/dev/null
  exit 1
fi

open "http://localhost:5275"
wait "\$SERVER_PID"
LAUNCHEOF
chmod +x "$APP_DST/Contents/MacOS/launch"

ok "App installed: $APP_DST"
ok "Find it in Launchpad or Spotlight — search for 'Claw Studio'"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────"
echo "${bold}${green}All done!${reset}"
echo ""
echo "  Open ${bold}Claw Studio${reset} from Launchpad, Spotlight, or /Applications."
echo ""

# Auto-start if running interactively in a terminal (not piped)
if [[ -t 1 ]]; then
  read -r -p "  Start Claw Studio now? [Y/n] " yn
  yn="${yn:-y}"
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    open "$APP_DST"
  fi
fi
