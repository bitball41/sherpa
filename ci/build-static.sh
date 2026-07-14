#!/bin/bash
set -euo pipefail

DST=${DST:-staticbuild}

rm -rf "$DST"
mkdir -p 	"$DST/baremux" 	"$DST/epoxy" 	"$DST/libcurl" 	"$DST/assets" 	"$DST/scram"

cp -a node_modules/@mercuryworkshop/bare-mux/dist/. "$DST/baremux/"
cp -a node_modules/@mercuryworkshop/epoxy-transport/dist/. "$DST/epoxy/"
cp -a node_modules/@mercuryworkshop/libcurl-transport/dist/. "$DST/libcurl/"
cp -a assets/. "$DST/assets/"
cp -a dist/. "$DST/scram/"
cp -a static/. "$DST/"

if [[ -d _docs ]]; then
	mkdir -p "$DST/typedoc"
	cp -a _docs/. "$DST/typedoc/"
fi
if [[ -d _docs-dev ]]; then
	mkdir -p "$DST/typedoc-dev"
	cp -a _docs-dev/. "$DST/typedoc-dev/"
fi

printf 'let _CONFIG = %s' 	"$(jq -c -n '{"wispurl": "wss://anura.pro/", "bareurl": "https://aluu.xyz/bare/"}')" 	> "$DST/config.js"

