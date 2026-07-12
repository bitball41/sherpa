#!/bin/bash
mkdir -p existing-typedoc existing-typedoc-dev

declare -A versions
found_versions=()

while read -r commit_hash commit_msg; do
    version=$(git show "$commit_hash:package.json" | jq -r '.version')
    
    if [ -n "$version" ] && [ "$version" != "null" ] && [ -z "${versions[$version]}" ]; then
        versions[$version]=1
        
        runs=$(gh run list --commit="$commit_hash" --json databaseId,status,conclusion --jq '.[] | select(.status == "completed" and .conclusion == "success") | .databaseId')
        
        for run_id in $runs; do
        artifacts=$(gh run view "$run_id" --json artifacts --jq '.artifacts[].name')

        if grep -qx "typedoc-current" <<< "$artifacts"; then
            rm -rf temp
            gh run download "$run_id" --name typedoc-current --dir temp
            archive=$(find temp -name "typedoc-$version.tar.gz" -print -quit)
            if [ -n "$archive" ]; then
                mkdir -p "existing-typedoc/v$version"
                tar -xzf "$archive" -C "existing-typedoc/v$version"
                found_versions+=("v$version")
            fi
        fi

        if grep -qx "typedoc-current-dev" <<< "$artifacts"; then
            rm -rf temp-dev
            gh run download "$run_id" --name typedoc-current-dev --dir temp-dev
            archive_dev=$(find temp-dev -name "typedoc-$version.tar.gz-dev" -print -quit)
            if [ -n "$archive_dev" ]; then
                mkdir -p "existing-typedoc-dev/v$version"
                tar -xzf "$archive_dev" -C "existing-typedoc-dev/v$version"
            fi
        fi

        rm -rf temp temp-dev
            
            [ ${#found_versions[@]} -gt 0 ] && break
        done
    fi
done < <(git log --oneline --follow -- package.json)

if [ ${#found_versions[@]} -gt 0 ]; then
    printf '%s\n' "${found_versions[@]}" | jq -R . | jq -s '{"versions": .}' > existing-typedoc/.typedoc-plugin-versions
    printf '%s\n' "${found_versions[@]}" | jq -R . | jq -s '{"versions": .}' > existing-typedoc-dev/.typedoc-plugin-versions
else
    echo '{"versions": []}' > existing-typedoc/.typedoc-plugin-versions
    echo '{"versions": []}' > existing-typedoc-dev/.typedoc-plugin-versions
fi
