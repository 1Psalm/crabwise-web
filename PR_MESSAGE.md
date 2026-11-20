# Pull Request: Validate HTTP request payloads before sending (#146)

Branch: `fix/146-validate-http-request-payloads-before-sending`  
Commit: `4aa7317`

## Summary

Adds request-payload validation at the shared request-validation boundary in `src/services/requestValidation.ts`:

- `validateRequestPayload` returns an error message for unsafe data and `null` for safe data.
- `assertValidRequestPayload` throws a typed `RequestPayloadValidationError` and returns valid payloads unchanged.
- `isRequestPayloadValid` plus short aliases for callers using other naming.
- Rejects XSS/SQL/NoSQL injection strings, prototype-pollution keys, traversal, non-serializable values (functions, symbols, bigint, circular references, non-finite numbers), and oversized payloads.
- Validates query-string keys/values in `validateRequestPath`, so unsafe query payloads are rejected before the request leaves the browser.
- Valid form/import payloads, primitives, and upload containers pass through untouched.

Tests covering these cases were added to `src/services/requestValidation.test.ts`.

## Files changed

- `src/services/requestValidation.ts`
- `src/services/requestValidation.test.ts`

## Verification

- `npx vitest run src/services/requestValidation.test.ts` — 20/20 passed.
- ESLint and Prettier clean for both changed files.
- Type-check clean for both changed files (full `tsc -b` still has a pre-existing syntax error in `src/components/ui/MediaLightbox.test.ts`).
- Full suite: 22 pre-existing failures unrelated to this change; 510 passing.
