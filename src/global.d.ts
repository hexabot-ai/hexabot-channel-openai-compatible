/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

// `@hexabot-ai/api`'s published `.d.ts` files still contain its own internal
// `@/...` path-aliased imports (tsc does not rewrite `paths`-based import
// specifiers to relative paths during declaration emit). A per-project
// `paths` mapping only resolves them when a local `node_modules` happens to
// exist at the expected relative location, which breaks for a package that
// has not been installed yet. Declaring the wildcard globally removes that
// dependency on `node_modules` layout entirely.
declare module '@/*';
