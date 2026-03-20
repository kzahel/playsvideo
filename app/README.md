# App README

`@playsvideo/app` is the browser media catalog built on top of the `playsvideo` engine.

It is responsible for:

- scanning local folders
- maintaining a durable media catalog
- storing per-device playback history
- syncing playback facts between devices
- enriching catalog entries with optional TMDB metadata
- presenting the catalog/player UI

This package is not the playback engine itself. The engine lives in the root `playsvideo` package.

## Start Here

- App architecture overview: [docs/app-architecture.md](/Users/kgraehl/code/playsvideo/docs/app-architecture.md)
- Data model notes: [docs/data-model-separation.md](/Users/kgraehl/code/playsvideo/docs/data-model-separation.md)
- TMDB metadata architecture: [docs/tmdb-metadata-architecture.md](/Users/kgraehl/code/playsvideo/docs/tmdb-metadata-architecture.md)

## Main Entry Points

- Routes: [app/src/routes.ts](/Users/kgraehl/code/playsvideo/app/src/routes.ts)
- Database schema: [app/src/db.ts](/Users/kgraehl/code/playsvideo/app/src/db.ts)
- Scan pipeline: [app/src/scan.ts](/Users/kgraehl/code/playsvideo/app/src/scan.ts)
- Player page: [app/src/pages/Player.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Player.tsx)
- Sync: [app/src/firebase.ts](/Users/kgraehl/code/playsvideo/app/src/firebase.ts)
- Metadata: [app/src/metadata](/Users/kgraehl/code/playsvideo/app/src/metadata)

## Core Concepts

- `catalog.id` is the stable local route/UI identity
- `canonicalPlaybackKey` is the cross-device playback identity
- `catalog` stores durable media rows
- `playback` stores this device's playback facts
- `remotePlayback` stores playback facts pulled from other devices

The app treats missing local files as `missing`, not deleted. The catalog is meant to outlive any one folder scan.

## Development

Run the app:

```bash
pnpm --filter app dev
```

Typecheck:

```bash
pnpm --filter app typecheck
```
