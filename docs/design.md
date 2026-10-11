# Word Atlas — server recreation

User-approved direction: preserve the original word-to-meaning clusters and navigation; deliver a portable Docker application for the user's own server.

## Architecture

TypeScript/Fastify serves a React application and a read-only SQLite dictionary. SQLite is selected instead of a separate PostgreSQL deployment because the recovered lexical corpus is immutable; entities and relationships use a normalized schema suitable for later migration. Java is an offline extraction dependency only. The server and client contain new implementation code, not the recovered JAR or decompiled code.

## Features

Search and suggestions across the full recovered English word set, separate clusters for each meaning, definitions/examples and clickable synonyms, part-of-speech filtering, explicit semantic relationship filters, incremental meaning expansion, word recentering, history, saved words, shareable URLs, zoom/pan/drag, animation pause, keyboard access and mobile layout. Browser settings and saved words are local to that browser.

The browser uses shell placement plus spring/repulsion forces, meaning group constraints, and rectangular label protection. This reproduces the original interaction concept; pixel-perfect and numerical equivalence are not claimed. Nodes refer to word IDs and meaning IDs independently so polysemy is preserved. Relation direction and lexical antonyms remain explicit.

## Data and limits

Recover all stored records using the original bundled read-only dictionary library. Import words, meaning memberships, definitions, examples, semantic relations, lexical relations and stems into SQLite. Validate row counts, array alignment, numeric encodings, foreign keys and representative words. Keep extraction provenance and original notices alongside the new application.

Bound graph responses and expansion size. Preserve total meaning counts even if a map is limited. Distinguish malformed requests, absent words and server errors. Parameterized queries and explicit query limits prevent search strings from becoming SQL or unbounded traversal.

## Verification and deployment

Type-check and production-build the client/server. Test actual database lookup, polysemy, spelling suggestions, stemming, relationship direction, incremental expansion, filters, boundedness and invalid API inputs. Verify navigation, map interaction and responsive behavior in a browser. Deliver a locked dependency tree, Dockerfile, Compose file, startup instructions and source archive with the full dictionary. Run the container as a non-root user and provide a health endpoint. A Docker engine is not present locally, so container execution must be reported separately from direct Node testing.

## Implementation sequence

1. Export and verify dictionary records.
2. Import normalized database and capture provenance.
3. Implement bounded typed API and tests.
4. Implement interactive map and dictionary explorer.
5. Build, browser-check, repair observed failures, package and document deployment.
