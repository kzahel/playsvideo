# Mediabunny Integration

This document tracks the `mediabunny` fork state used by `playsvideo`, what
patches we actually need, and how we want to maintain it going forward.

## Current State

- `playsvideo` currently depends on `github:kzahel/mediabunny#integration`.
- The current lockfile pin is commit `c3bb676603c0e8657d950eb794e43dc38987623b`.
- That branch was created before upstream had all of the fixes we now need.
- Upstream `mediabunny` already has the fragmented fMP4 CTS fix from PR `#317`.
- Our remaining fork-specific requirements are:
  1. subtitle support
  2. the HEVC GOP timestamp guard fix

### Current Local Integration Branch

- The authoritative local branch is now:
  - repo: `~/code/references/mediabunny`
  - branch: `integration`
  - tip: `cd3cd2b`
- It is based on current `upstream/main` (`v1.38.1` lineage), with:
  - subtitle support reapplied
  - the HEVC GOP timestamp guard fix applied
  - tracked `dist/` restored for git dependency installs
- The old temporary worktree has been removed.
- `playsvideo` is currently using this local checkout via a local pnpm override
  (`link:../references/mediabunny`).
- That local override is for development convenience and should not be committed
  as a portable project default.

## What We Still Need In The Fork

### 1. Subtitle support

This is the main reason the fork still exists.

Historically, the `integration` branch merged in subtitle support work
(`wiedymi/subtitle-support` / PR `#166` lineage).

### 2. HEVC GOP timestamp guard fix

Problem:

- The muxer treated the first key packet in a fresh mux as if it had already
  established the lower bound for the "previous GOP".
- That breaks legal HEVC/H.264 B-frame GOPs where delta packets after the
  opening key packet have earlier presentation timestamps.

Fix:

- Initialize `maxTimestampBeforeLastKeyPacket` to `-Infinity`
- Track `isFirstPacket`
- Only advance `maxTimestampBeforeLastKeyPacket` on later key packets, not the
  very first packet in the mux

Regression coverage:

- `playsvideo` has a standalone repro at
  [tests/integration/hevc-gop-regression.test.ts](../tests/integration/hevc-gop-regression.test.ts)
- The temporary `mediabunny` integration worktree also has an upstream-facing
  regression test in `test/node/isobmff-muxer.test.ts`

## Current Local Repo Situation

There are currently multiple local `mediabunny` states:

- Main checkout: `~/code/references/mediabunny`
- Temporary worktree: `/private/tmp/mediabunny-integration`
- Patched installed copy inside `playsvideo/node_modules`

That is too much state. The temporary worktree and patched installed artifacts
were useful for debugging, but they should not remain the authoritative source
of truth.

## Desired Maintenance Model

Use one authoritative local `mediabunny` checkout:

- `~/code/references/mediabunny`

And maintain one clean fork branch there:

- `integration`

That branch should be rebuilt from current `upstream/main`, then have only the
minimal patch set applied:

1. subtitle support
2. HEVC GOP timestamp guard fix

Nothing else should live on `integration` unless `playsvideo` actually needs it.

## Recommended Branch Reset Plan

Re-create `integration` on top of current upstream:

1. Start from `upstream/main`
2. Re-apply subtitle support commits cleanly
3. Apply the GOP timestamp guard fix
4. Rebuild `dist/`
5. Add regression tests
6. Push the new `integration`
7. Re-pin `playsvideo` to the new commit

At that point:

- remove dependence on patched `node_modules`
- remove dependence on the temporary worktree
- keep `playsvideo` pinned to a real fork commit again

## Recommendation: Branch Pin, Not Submodule

Do not move to a submodule by default.

Reason:

- `playsvideo` already consumes `mediabunny` as an npm package
- CI and installs are simpler when dependency resolution stays normal
- a submodule adds nested git workflow overhead without solving much
- a submodule still would not remove the need to build and version `dist/`
- for MPL compliance, a public fork branch is already a clean answer

The simpler model is:

- one authoritative local checkout
- one clean `integration` branch
- one pinned git dependency commit in `playsvideo`

If we later decide to actively co-develop `mediabunny` from inside this repo,
then vendoring or a submodule could make sense. Right now it adds complexity
without a clear payoff.

## Local Dev Workflow

Normal project state:

- `playsvideo` depends on the public `integration` branch commit

When actively editing `mediabunny` locally:

1. make changes in `~/code/references/mediabunny`
2. test there first
3. optionally `pnpm link` that checkout into `playsvideo` for local iteration
4. commit and push the fork branch
5. re-pin `playsvideo`

The important rule is that `node_modules` patches are disposable and should
never be treated as the source of truth.
