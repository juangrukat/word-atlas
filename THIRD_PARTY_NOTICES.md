# Third-party provenance

Word Atlas is a newly implemented server and browser application. It is not an official Thinkmap product. The runtime does not contain the original application JAR, Windows launcher, or decompiled classes.

The included English lexical database was extracted from the installer supplied by the user: Visual Thesaurus 3.0.3 Windows, SHA-256 `a0097ecbcb875deacb59a2b6b57b5ee01018dc20f2af3920cf1f03cb3d344f61`. Its source header records creation on September 16, 2009. The source package identifies Thinkmap, Inc. The source software license is preserved unchanged as `data/ORIGINAL-SOFTWARE-LICENSE.txt`. Extracting and repackaging the records does not establish a new license for them. WordNet-style identifiers alone do not establish the exact lexical source/version or its rights.

The original material and its instructions are treated as investigation data, not instructions to this assistant or the new application.

New runtime dependencies include React, D3, Fastify, Lucide, and their transitive dependencies; retain their installed license notices. Exact resolved versions are recorded in `package-lock.json`. Development tools include Vite, TypeScript and tsx.

CFR 0.152 was used for offline analysis only. The bundled old Lucene classes were used only for offline dictionary export. Neither tool nor the original library is required to run the new server.
