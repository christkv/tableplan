# Phase 10: Vector and Hybrid Search

## Objective

Add semantic recipe discovery while preserving deterministic FTS, ingredient filters, authorization, and a complete fallback when Cloudflare AI or Vectorize is unavailable.

## Dependencies

- Phase 3 search contract and relevance baseline.
- Phase 2 normalized recipe text.
- Cloudflare Workers AI and Vectorize preview bindings.

This phase can begin after Phase 3, but must integrate with the Phase 6 API and Phase 7 MCP contracts before Phase 11.

## Deliverables

- Versioned recipe embedding-document builder.
- Queue-backed embedding generation and Vectorize upsert workflow.
- Embedding status/version records associated with recipe IDs.
- Hybrid candidate retrieval and ranking service.
- Search modes: `text`, `semantic`, and `hybrid`.
- Automatic FTS-only fallback with observable reason codes.
- Compact recipe-document/data-source representation with source IDs and citations.
- Relevance evaluation corpus and metrics.

## Embedding Document

Build a bounded text representation from:

- Recipe name and description.
- Normalized ingredient names.
- Selected tags and diet/course labels.
- A short instruction summary or initial steps when useful.
- Quality/version metadata outside the embedded prose.

The document builder is deterministic and versioned. Changing the model or builder version schedules re-embedding rather than silently mixing incompatible vectors.

## Query Flow

1. Normalize query and hard filters.
2. Run FTS candidate retrieval.
3. If semantic mode is available, embed the query and retrieve Vectorize candidates.
4. Merge candidates by stable recipe ID.
5. Apply relational ingredient, tag, dietary, serving, and quality filters in D1.
6. Rank using normalized semantic score, FTS score, exact matches, and documented boosts/penalties.
7. Return search mode used, bounded score explanations, and source metadata.

Vector metadata contains only coarse filters with proven query value. Ingredient filtering remains relational.

## Implementation Sequence

1. Create a hand-reviewed relevance query set with expected useful and forbidden results.
2. Implement and version the embedding-document builder.
3. Build local mock/fixture mode and preview Workers AI embedding jobs.
4. Add queue batching, retry, idempotent upsert, and dead-letter reporting.
5. Implement hybrid retrieval/ranking behind a feature flag.
6. Extend UI, REST, and MCP search contracts without breaking text mode.
7. Tune ranking against the relevance set and log fallback/latency metrics.

## Verification

- Unit tests for deterministic document construction and ranking.
- Idempotency tests for queue retries and duplicate embedding jobs.
- Relevance evaluation comparing FTS and hybrid results.
- Ingredient exclusion/allergy tests proving vector candidates cannot bypass hard filters.
- Failure tests for missing bindings, model errors, queue failures, and stale embedding versions.
- API/MCP compatibility tests for all three search modes.

## Acceptance Criteria

- Natural-language queries produce measurably better reviewed results than FTS alone on the evaluation set.
- Exact ingredient/tag filters remain authoritative.
- Local development and production requests automatically fall back to FTS when semantic services fail.
- Every vector result resolves to a current relational recipe and includes source metadata.
- Re-indexing is resumable, versioned, and does not require application downtime.

## Non-Goals

- One embedding per ingredient or instruction step unless evaluation demonstrates a need.
- Replacing D1 relational filters with Vectorize metadata.
- Personalized recommendation ranking beyond simple documented boosts.

## Exit Artifact

A measured hybrid search system available through UI, REST, and MCP with a reliable text-search fallback.
