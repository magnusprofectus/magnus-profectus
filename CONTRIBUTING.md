# Contributing

Thanks for your interest in improving Magnus Profectus.

## Ground rules

- The app is opinionated by design. It carries one training method. Changes that dilute the method (general-purpose fitness features, social features, ads, trackers, analytics) will not be merged.
- Copy discipline: plain, team voice, no hype. Explanations live in one quiet line or an info modal, never as clutter on the active session screen.
- License: AGPL-3.0. By contributing you agree your work is published under the same license.

## Workflow

1. Open an issue first for anything that changes behavior or copy.
2. Keep the build green: `npm run build` and `npx vitest run` must pass.
3. All writes to training data go through `src/data/repo.ts`; never write to Dexie tables directly.
4. Small, focused diffs are merged faster than large ones.

## Note on licensing

The project is currently maintained by its author only. If external contributions become substantial, a contribution agreement may be introduced to keep dual-licensing options open. Until then, contributions are accepted under AGPL-3.0 as-is.