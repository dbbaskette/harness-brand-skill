#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
for candidate in "${BRAND_PYTHON:-python3}" python3.14 python3.13 python3.12 python3.11 /opt/homebrew/bin/python3; do
  if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; assert sys.version_info >= (3,11)' 2>/dev/null; then
    runtime=$(command -v "$candidate")
    break
  fi
done
if [[ -z "${runtime:-}" ]]; then
  echo 'Python 3.11+ is required. Set BRAND_PYTHON to an existing interpreter.' >&2
  exit 1
fi
"$runtime" "$root/scripts/brand_assets.py" install "$@"
"$runtime" -m venv "$root/.venv"
"$root/.venv/bin/python3" -m pip install --disable-pip-version-check -r "$root/requirements.txt"

if ! "$root/.venv/bin/python3" -c 'from PIL import features; assert features.check("raqm")' 2>/dev/null; then
  echo 'Optional font shaping is unavailable: icon-font conversion will be reported unresolved.'
  if [[ "$(uname -s)" == Darwin ]]; then
    echo 'For Material Icons conversion on macOS, install FriBiDi with: brew install fribidi'
  fi
fi
