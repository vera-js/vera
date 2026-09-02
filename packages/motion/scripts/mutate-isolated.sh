#!/bin/sh
# Runs the mutation suite in throwaway git worktrees, several at once.
#
# `mutate.js` writes a deliberate bug into `src/`, runs the suite, and writes
# the file back. Doing that in the working tree means the tool and whoever is
# editing are the same files: an edit made mid-run is reverted by the restore,
# and a run killed mid-mutation leaves a planted defect behind. Both have
# happened here.
#
# The shard count scales with how many mutations were selected: a full run gets
# one per core, a single concern gets one, because a worktree costs more than a
# handful of mutations saves. `MUTATE_WORKERS` overrides. Numbers below.
#
# **Never remove one of these worktrees by hand while a run is in flight.**
# Deleting the source out from under a live `mutate.js` kills it with ENOENT
# partway through, and the run reports nothing. `npm run mutate:clean` removes
# only worktrees with no live process.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
# The git repository is the monorepo, two levels up; worktrees are checkouts of
# it, placed beside it, with this package's working tree mirrored into place.
repo=$(cd "$root/../.." && pwd)

# `--list` reads the mutation table and runs nothing, so it needs no worktree.
case " $* " in
  *" --list "*) exec node "$root/scripts/mutate.js" "$@" ;;
esac

# How many mutations this run will actually plant. `--count` exits non-zero on
# a filter that matches nothing, so the filter is validated before any worktree
# exists.
selected=$(node "$root/scripts/mutate.js" --count "$@")

# Shards are worth their setup only when there is enough work to amortise it —
# each one costs a worktree and an rsync. Measured on 8 cores, on mains:
#
#   70 mutations   1 shard  913s     8 shards  776s   <- sharding wins by 15%
#   10 mutations   1 shard  127s     8 shards  344s   <- setup dominates, 2.7x worse
#
# Which is why the small-selection measurement must not be extrapolated: it
# says sharding loses, and on a full run it does not. One shard per 8 mutations,
# capped at the core count.
if [ -z "${MUTATE_WORKERS:-}" ]; then
  cores=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
  workers=$(( selected / 8 ))
  if [ "$workers" -lt 1 ]; then workers=1; fi
  if [ "$workers" -gt "$cores" ]; then workers=$cores; fi
else
  workers=$MUTATE_WORKERS
fi

# Validated before it is used in arithmetic. `[ "$x" -lt "$y" ]` on a
# non-integer prints an error and returns non-zero without tripping `set -e`,
# so a bad `MUTATE_WORKERS` used to sail through: no worktree was built, no
# shard ran, and the aggregator reported `0/0 mutations caught` and exited 0.
case "$workers" in
  '' | *[!0-9]*) echo "  MUTATE_WORKERS must be a positive integer, got: '$workers'"; exit 1 ;;
esac
if [ "$workers" -lt 1 ]; then echo "  MUTATE_WORKERS must be at least 1."; exit 1; fi

if [ "$selected" -lt "$workers" ]; then workers=$selected; fi

# Unique per run. A fixed path means two runs share one directory, and the
# second one's `rm -rf` deletes the first one's source mid-mutation: the first
# then dies on ENOENT having already written a mutation it can no longer
# restore. A quick `--group` check while a full run is in flight is exactly the
# situation that hits it.
stamp=$$
out=$(mktemp -d)

cleanup() {
  i=0
  while [ "$i" -lt "$workers" ]; do
    wt="$repo/../.vera-motion-mutate-$stamp-$i"
    # `if`, not `[ -d ] && …` — under `set -e` that returns non-zero for a
    # directory that is already gone and aborts the rest of the cleanup.
    if [ -d "$wt" ]; then
      git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
    fi
    i=$((i + 1))
  done
  # Prunes only entries whose directory is gone, so a concurrent run is safe.
  git -C "$repo" worktree prune
  rm -rf "$out"
}
# Also on interrupt, or a Ctrl-C leaves eight worktrees behind rather than one.
trap cleanup EXIT INT TERM

git -C "$repo" worktree prune

# Built in parallel: eight serial `git worktree add` plus rsync was most of the
# wall clock on a short run.
i=0
while [ "$i" -lt "$workers" ]; do
  wt="$repo/../.vera-motion-mutate-$stamp-$i"
  rm -rf "$wt"
  git -C "$repo" worktree add --detach "$wt" HEAD >/dev/null

  # The worktree starts at HEAD, which is not what you want to test: the whole
  # point of running this is the change you have not committed yet. Mirroring
  # the working tree over it is what makes the isolation free rather than a
  # trap — a run that silently tests HEAD reports "0/0 mutations" for a brand
  # new mutation and looks like a pass.
  mkdir -p "$wt/packages/motion"
  rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude 'coverage' \
    "$root/" "$wt/packages/motion/" &
  i=$((i + 1))
done
wait

i=0
while [ "$i" -lt "$workers" ]; do
  # The workspace root owns the tooling, so the hoisted node_modules is the one
  # to link. The `@verajs/motion` self-alias never goes through it: the test
  # preload resolves that specifier to the worktree's own (mutated) src.
  ln -s "$repo/node_modules" "$repo/../.vera-motion-mutate-$stamp-$i/node_modules"
  i=$((i + 1))
done

i=0
while [ "$i" -lt "$workers" ]; do
  wt="$repo/../.vera-motion-mutate-$stamp-$i"
  # `--here` is the point of the worktree: this *is* the throwaway copy, so
  # mutating it in place is exactly right. The flag exists so that doing it
  # anywhere else has to be typed out.
  (cd "$wt/packages/motion" && node scripts/mutate.js --here --shard "$i:$workers" --json "$out/shard-$i.json" "$@") &
  i=$((i + 1))
done

# `wait` without an argument returns 0 even when a child failed, so each shard
# writes its result to a file and one aggregator decides the verdict. A shard
# that dies writes nothing, and the missing file is what makes that visible
# rather than silently reducing the total.
wait

produced=$(ls "$out" 2>/dev/null | wc -l | tr -d ' ')
if [ "$produced" -ne "$workers" ]; then
  echo "  $produced of $workers shards reported — one died and its mutations were never run."
  exit 1
fi

node "$root/scripts/mutate.js" --report "$out"
