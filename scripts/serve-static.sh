#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

cleanup() {
	if [ -n "${SERVER_PID:-}" ]; then
		kill "$SERVER_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

pnpm install

if [ ! -f "rewriter/wasm/out/wasm.js" ] || [ ! -f "dist/sherpa.wasm.wasm" ]; then
    pnpm run rewriter:build
fi
if [ ! -f "dist/sherpa.all.js" ] || [ ! -f "dist/sherpa.sync.js" ]; then
    pnpm run build
fi

bash ci/download-existing-docs.sh
bash ci/build-docs.sh
bash ci/build-static.sh

replace_docs_url() {
	local file="$1"
	local replacement="$2"
	if sed --version >/dev/null 2>&1; then
		sed -i "s|url=dev/|url=${replacement}|g" "$file"
	else
		sed -i '' "s|url=dev/|url=${replacement}|g" "$file"
	fi
}

if [ -f "staticbuild/typedoc/index.html" ]; then
	replace_docs_url "staticbuild/typedoc/index.html" "/typedoc/dev/"
fi
if [ -f "staticbuild/typedoc-dev/index.html" ]; then
	replace_docs_url "staticbuild/typedoc-dev/index.html" "/typedoc-dev/dev/"
fi

cd staticbuild
echo "Demo server starting at http://localhost:3000"
echo "TypeDoc available at http://localhost:3000/typedoc"
npx serve -l 3000 &
SERVER_PID=$!

wait "$SERVER_PID"
