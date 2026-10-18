# Contributing to MemoryDock

Thank you for helping improve MemoryDock. Open an issue before a large change so maintainers and contributors can agree on the intended behavior.

## Local setup

Follow [the installation guide](docs/INSTALL.md). For development, work in `server/` and run:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build:admin
npm run build
```

Keep changes focused. Add or update a test when behavior changes, and update both English and Chinese user documentation when instructions change. Use English for code, errors, comments, and pull request descriptions. Do not commit API keys, personal notes, generated `dist/`, `node_modules/`, or package tarballs.

## Pull requests

Describe the user-visible change, how you tested it, and any data migration or compatibility impact. MemoryDock should continue to bind to loopback and keep Markdown notes as the canonical data. CI must pass before review.

By submitting a contribution, you agree that it is licensed under this repository's [Apache-2.0 license](LICENSE).

## Maintainer release workflow

This repository is the active source tree. Before packaging, `npm run check:local-version` in `server/` confirms that the source version is at least the globally installed version. `npm pack` runs the same check automatically.

Before publishing a release, review the files and commit history for credentials, user data, generated artifacts, and machine-specific paths. Run the required checks, commit the release, and push to GitHub `main` without force.
