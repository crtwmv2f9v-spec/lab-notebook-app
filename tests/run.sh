#!/bin/sh
# Pre-release check: undefined names (ESLint no-undef), then every view in headless Chrome, then screenshot comparison.
#   sh tests/run.sh             compare with tests/baseline/
#   sh tests/run.sh --baseline  accept the current look as the new baseline
cd "$(dirname "$0")/.." || exit 1
node tests/imports.mjs || exit 1
npx --yes eslint@9.39.1 --no-config-lookup -c tests/eslint.config.mjs js/ || exit 1
node tests/smoke.mjs "$@" || exit 1
[ "$1" = "--baseline" ] || python3 tests/compare.py
