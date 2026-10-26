#!/usr/bin/env bash
# Fork: run this checkout as the desktop app on the INSTALLED app's data and
# keys, so sessions carry over. Quit the installed LearnHarness first — two
# apps writing the same data folder can corrupt sessions.
#
#   bash scripts/fork-desktop.sh        (Ctrl+C to stop)
#
# The dev server listens on 127.0.0.1 only: with your API key loaded it must
# not be reachable from the rest of the network.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_SUPPORT="$HOME/Library/Application Support/LearnHarness"
PORT="${PORT:-3000}"

if pgrep -f "/Applications/LearnHarness.app/Contents/MacOS/LearnHarness" >/dev/null; then
	echo "The installed LearnHarness is running. Quit it (Cmd+Q) and run this again." >&2
	exit 1
fi

export LH_DATA_DIR="$APP_SUPPORT/data"
export LH_AUTH_FILE="$APP_SUPPORT/auth.json"

exec npx concurrently -k --names next,electron \
	"next dev -H 127.0.0.1 -p $PORT" \
	"until curl -s -o /dev/null http://127.0.0.1:$PORT; do sleep 1; done; LH_DEV_URL=http://127.0.0.1:$PORT electron ."
