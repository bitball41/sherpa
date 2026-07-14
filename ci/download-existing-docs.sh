#!/bin/bash
mkdir -p existing-typedoc existing-typedoc-dev

declare -A user_versions
declare -A dev_versions
found_user_versions=()
found_dev_versions=()

while read -r commit_hash commit_msg; do
    version=$(git show "$commit_hash:package.json" | jq -r '.version')
    if [ -z "$version" ] || [ "$version" = "null" ]; then
        continue
    fi
    if [ -n "${user_versions[$version]:-}" ] && [ -n "${dev_versions[$version]:-}" ]; then
        continue
    fi

    runs=$(gh run list --commit="$commit_hash" --json databaseId,status,conclusion --jq '.[] | select(.status == "completed" and .conclusion == "success") | .databaseId')

    for run_id in $runs; do
        artifacts=$(gh run view "$run_id" --json artifacts --jq '.artifacts[].name')

        if [ -z "${user_versions[$version]:-}" ] && grep -qx "typedoc-current" <<< "$artifacts"; then
            rm -rf temp
            if gh run download "$run_id" --name typedoc-current --dir temp; then
                archive=$(find temp -name "typedoc-$version.tar.gz" -print -quit)
                if [ -n "$archive" ]; then
                    destination="existing-typedoc/v$version"
                    rm -rf "$destination"
                    if mkdir -p "$destination" && tar -xzf "$archive" -C "$destination"; then
                        user_versions[$version]=1
                        found_user_versions+=("v$version")
                    else
                        rm -rf "$destination"
                    fi
                fi
            fi
        fi

        if [ -z "${dev_versions[$version]:-}" ] && grep -qx "typedoc-current-dev" <<< "$artifacts"; then
            rm -rf temp-dev
            if gh run download "$run_id" --name typedoc-current-dev --dir temp-dev; then
                archive_dev=$(find temp-dev -name "typedoc-$version.tar.gz-dev" -print -quit)
                if [ -n "$archive_dev" ]; then
                    destination_dev="existing-typedoc-dev/v$version"
                    rm -rf "$destination_dev"
                    if mkdir -p "$destination_dev" && tar -xzf "$archive_dev" -C "$destination_dev"; then
                        dev_versions[$version]=1
                        found_dev_versions+=("v$version")
                    else
                        rm -rf "$destination_dev"
                    fi
                fi
            fi
        fi

        rm -rf temp temp-dev

        if [ -n "${user_versions[$version]:-}" ] && [ -n "${dev_versions[$version]:-}" ]; then
            break
        fi
    done
done < <(git log --oneline --follow -- package.json)

if [ ${#found_user_versions[@]} -gt 0 ]; then
    printf '%s\n' "${found_user_versions[@]}" | jq -R . | jq -s '{"versions": .}' > existing-typedoc/.typedoc-plugin-versions
else
    echo '{"versions": []}' > existing-typedoc/.typedoc-plugin-versions
fi

if [ ${#found_dev_versions[@]} -gt 0 ]; then
    printf '%s\n' "${found_dev_versions[@]}" | jq -R . | jq -s '{"versions": .}' > existing-typedoc-dev/.typedoc-plugin-versions
else
    echo '{"versions": []}' > existing-typedoc-dev/.typedoc-plugin-versions
fi
