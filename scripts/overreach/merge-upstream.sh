#!/usr/bin/env bash
# Merge OpenFront's main into this fork. Overreach deleted OpenFront's shell (store, accounts,
# clans, lobbies...), so when upstream edits a file we deleted, git reports it as "deleted by us":
# keep it deleted. Anything else that conflicts (Main.ts, index.html, our hooks) is left for you.
set -u
git fetch upstream || exit 1
if git merge upstream/main --no-edit; then exit 0; fi

# "DU" = unmerged, deleted by us.
git status --porcelain | awk '$1 == "DU" { print $2 }' | xargs -r git rm -q --

left=$(git diff --name-only --diff-filter=U)
if [ -n "$left" ]; then
  echo "Resolve these by hand, then 'git commit':"
  echo "$left"
  exit 1
fi
git commit --no-edit
