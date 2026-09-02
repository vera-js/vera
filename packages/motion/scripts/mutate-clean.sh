#!/bin/sh
# Removes leftover mutation worktrees — but only ones nothing is using.
#
# Written after deleting a live run's worktree by hand: `mutate.js` died on
# ENOENT partway through, having reported nothing, and the "stray" directory
# was the source of a run that was still going. The check that failed was
# `pgrep -fc`, which macOS does not support — BSD pgrep has no `-c`, so it
# errored, the `|| echo 0` fallback swallowed it, and a live run looked idle.
#
# `ps` with a bracketed pattern is the check that works here.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$root/../.." && pwd)

if ps ax | grep -q '[s]cripts/mutate.js'; then
  echo "  a mutation run is in flight — refusing to remove anything."
  echo "  wait for it, or stop it first; deleting its worktree kills it mid-mutation."
  exit 1
fi

removed=0
for wt in "$repo"/../.vera-motion-mutate-*; do
  [ -d "$wt" ] || continue
  git -C "$repo" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
  removed=$((removed + 1))
done
git -C "$repo" worktree prune

echo "  removed $removed leftover worktree(s)."
