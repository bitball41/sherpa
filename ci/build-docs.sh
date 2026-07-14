#!/bin/bash
set -euo pipefail

mkdir -p _docs _docs-dev
if [[ -d existing-typedoc ]]; then
	cp -a existing-typedoc/. _docs/
fi
if [[ -d existing-typedoc-dev ]]; then
	cp -a existing-typedoc-dev/. _docs-dev/
fi

pnpm run docs
pnpm run docs:dev

VERSION=$(jq -r '.version' package.json)

merge_versions() {
	local output_dir=$1
	local history_dir=$2
	local output_manifest="$output_dir/.typedoc-plugin-versions"
	local history_manifest="$history_dir/.typedoc-plugin-versions"

	# No manifest to merge is a normal skip, not a failure under `set -e`.
	[[ -f "$output_manifest" ]] || return 0

	local existing_versions=""
	if [[ -f "$history_manifest" ]]; then
		existing_versions=$(jq -r '.versions[]?' "$history_manifest")
	fi

	if [[ -n "$existing_versions" ]]; then
		printf '%s\n' "$existing_versions" "v$VERSION" |
			sort -u |
			jq -R . |
			jq -s --arg dev "v$VERSION" '{"versions": ., "dev": $dev}' > "$output_manifest"
	else
		jq -n --arg version "v$VERSION" \
			'{"versions":[$version],"dev":$version}' > "$output_manifest"
	fi
}

merge_versions _docs existing-typedoc
merge_versions _docs-dev existing-typedoc-dev

tar -czf "typedoc-$VERSION.tar.gz" -C _docs .
tar -czf "typedoc-$VERSION.tar.gz-dev" -C _docs-dev .
