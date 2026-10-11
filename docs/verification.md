# Verification — October 11, 2026

## Data

Recovered 548,880 English stored records and 117,660 synset stored records, including one header in each set. Imported 148,730 words, 117,659 meanings, 117,659 definitions, 206,978 word/meaning memberships, and 377,488 semantic/lexical relations. Parallel field arrays were checked during import. SQLite `integrity_check` returned `ok`; `foreign_key_check` returned no violations. Final database size: 62,373,888 bytes.

## Automated checks

`npm test`: 19 passed, 0 failed after the ambiguous-word stress-test fixes. The tests use the included real database, not a miniature fixture. Coverage includes corpus counts, bank's 18 distinct meanings, valid/bounded graph edges, part-of-speech filtering, broader/narrower direction, lexical antonyms, meaning expansion, case/space normalization, irregular-form lookup, spelling suggestions and transpositions, HTTP input validation, useful 404 responses, parameterized-query behavior, health/stats, JSON API fallback separation, HTML cache revalidation, and independent anchors for expanded meaning clusters.

`npm run build`: strict TypeScript check, Vite production build, and Node server compilation passed. Client JavaScript is approximately 337 KB uncompressed / 106 KB gzip; CSS approximately 18 KB / 5 KB gzip. No external fonts or network-hosted visual assets are required.

`npm audit`: no reported vulnerabilities in the resolved production or development dependencies. The old static-serving dependency was upgraded before release.

## Direct runtime and browser checks

The production build ran under Node 22.22.3 on macOS arm64 and served successful HTTP responses on loopback port 3000.

Verified through the Codex in-app browser:

- Search bank and display all 18 definitions.
- Select the financial meaning and incrementally expand the map from 17 to 46 nodes.
- Save bank and retain it after reload.
- Filter bank to its eight verb meanings.
- Search happy, select opposites, fit the map and navigate to unhappy by clicking its map node.
- Pause/resume control changes correctly.
- Open help and dismiss it with Escape.
- Misspelled hapy displays an absent-word message and suggested alternatives.
- Downloaded the actual generated `word-atlas-wonder.svg` successfully.
- Final release browser console had no errors or warnings.

Responsive testing used a same-origin 390 × 844 iframe because the browser's viewport override did not change its existing native viewport. The framed app's actual `window.innerWidth` was 390 and its document width was 375 after the vertical scrollbar; there was no horizontal document overflow. Its map height was 470. Verified fit-map and meaning selection/definition display in this frame. The temporary served harness was removed from the production output; its reusable source remains in `tests/mobile-preview.html`.

## Limits

The later 24-word stress run and two fixes are documented in `stress-test.md`.

The local Mac has no Docker engine, but GitHub CI subsequently verified a fresh clone on Linux: 19 tests, production build, `docker compose up --build -d`, container health, the complete dictionary count, bank/run/break lookups and client JavaScript delivery all passed. The image ran with the Compose read-only filesystem and non-root user. [CI evidence](https://github.com/juangrukat/word-atlas/actions/runs/38148618925). No deployment to the user's own server was performed. The original desktop application was not run for pixel-level comparisons. This is a modern functional recreation, not a certification of identical physics or complete desktop feature parity.

Node 22's built-in SQLite API currently emits an experimental API warning. The app is pinned to the Node 22 line. The recovered lexical corpus is from 2009; its source notices are preserved.
