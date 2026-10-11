# Ambiguous-word stress test — October 11, 2026

## Result

All 24 tested entries preserved their full definition sets and separate meaning IDs. Each was checked under all six relationship modes, available part-of-speech filters, and expansion of its first, middle and final meaning. Graphs stayed connected, had no duplicate IDs or dangling/self edges, and respected the 180-node response limit. The largest tested response was 67,392 bytes.

| Word | Meanings | Parts of speech |
| --- | ---: | --- |
| break | 75 | noun, verb |
| cut | 70 | noun, verb, adjective |
| run | 57 | noun, verb |
| play | 52 | noun, verb |
| make | 51 | noun, verb |
| light | 46 | noun, verb, adjective, adverb |
| draw | 45 | noun, verb |
| hold | 45 | noun, verb |
| set | 44 | noun, verb, adjective |
| take | 44 | noun, verb |
| charge | 40 | noun, verb |
| right | 36 | noun, verb, adjective, adverb |
| lead | 31 | noun, verb |
| strike | 27 | noun, verb |
| pitch | 22 | noun, verb |
| match | 19 | noun, verb |
| bank | 18 | noun, verb |
| seal | 14 | noun, verb |
| spring | 11 | noun, verb |
| club | 11 | noun, verb |
| bat | 10 | noun, verb |
| bass | 9 | noun, adjective |
| bark | 9 | noun, verb |
| pen | 6 | noun, verb |

These counts are for the requested lowercase entries. The database also preserves distinct capitalized proper-name entries such as `Set` and `Light`; exact spelling determines which entry is selected.

## Local load result

294 correctness requests, followed by 432 lookup requests at concurrency eight. Sequential lookup median: 2.71 ms; 95th percentile: 6.89 ms. At concurrency eight, median: 26.73 ms; 95th percentile: 37.21 ms; maximum: 38.98 ms. The concurrent phase processed approximately 328 requests per second over 1.32 seconds.

The benchmark used Fastify's in-process HTTP injection on this Mac, with different client identities so legitimate load testing did not bypass or disable the configured per-IP limiter. It excludes network transit, reverse proxies and Docker overhead and is not a sustained production-capacity claim. The isolated benchmark process reported approximately 343 MiB RSS after the run; this includes the test harness, buffered responses and garbage not necessarily collected at that instant, and is not a leak measurement.

A separate same-client burst produced exactly 120 successful requests and five HTTP 429 responses. Health checks and another client remained available.

Reproduce with `npm run stress`. Detailed measurements are in `stress-results.json`.

## Problems found and fixed

1. **Rate limiting was not attached to API routes.** Registration was deferred until after synchronous route declarations, so the plugin missed those declarations. Application construction now awaits the plugin before registering routes. The burst regression test verifies the actual limit, health exemption and other-client availability.
2. **Spring forces could settle with overlapping labels on dense maps.** Captured the 180-node `break` layout, which had 12 overlapping word-label pairs in logical coordinates. Added a final collision-free placement step that preserves fixed nodes. The captured-layout regression test verifies no overlapping word labels and finite positions.

`npm test` now passes 19 tests; strict TypeScript and the production build pass.

## Browser checks

- `run`: all 57 definition cards present; increased map to 32 primary meanings; 77 nodes, no invalid coordinates or measured word-label overlaps. Selected and expanded the final definition, which is beyond the 32-meaning overview; map increased to 86 nodes.
- Before the fix, a 180-node `break` map exhibited overlapping labels; the retained geometry fixture reproduces it.
- After the fix, maximum-size `break`, `set` and `light` maps each rendered 180 nodes with no measured word-label overlaps or invalid transforms.
- `right`: all 36 definitions, 167-node relationship map, no measured overlaps or invalid transforms.
- `spring`: all 11 definitions, 88-node relationship map; noun-only synonym view had six definitions and 19 nodes. Both rendered without measured word-label overlaps or invalid transforms.
- Final browser console had no errors or warnings.

Browser summaries are in `browser-stress-results.json` in capture order; the pre-fix `break` failure is deliberately retained before its corrected result.

## Practical readability

The full 180-node view is useful as an overview, but its labels become small when fitted into the entire canvas. Read the detail panel, filter parts of speech/relationship types, zoom, or expand individual meanings for close exploration. The graph limit affects the overview, not the full definition list. No Docker or remote-server test was performed.
