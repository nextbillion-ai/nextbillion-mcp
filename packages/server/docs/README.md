# Documentation knowledge base: inputs, mapping and eval set

This directory holds the checked-in inputs for the documentation tools (`search_documentation`, `get_documentation`, `get_api_parameters`, `list_documentation_topics`). The source is the private repository `nextbillion-ai/nb-public-docs`; nothing here requires access to it at build or test time.

| File                            | What it is                                                                                 | Maintained by                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `docs-pin.json`                 | The docs commit the committed inputs were taken from, and the date of the sitemap snapshot | `npm run docs:validate -- --docs … --write`        |
| `docs-files.txt`                | Every Markdown page in the docs repo at the pinned commit                                  | same                                               |
| `sitemap-urls.txt`              | Snapshot of the live sitemap (`https://docs.nextbillion.ai/sitemap-0.xml`), URL paths only | `npm run docs:validate -- --fetch-sitemap --write` |
| `url-overrides.json`            | Folder aliases and page overrides for the path-to-URL mapping (see below)                  | by hand                                            |
| `reports/files-without-urls.md` | Pages that are not indexed, and why                                                        | `npm run docs:validate -- --write`                 |
| `reports/urls-without-files.md` | Live pages with no source in the docs repo (known coverage gap)                            | same                                               |
| `eval/questions.json`           | Labelled retrieval questions with expected pages (schema below)                            | by hand; owner named in `#nextbillion-mcp`         |

## How a page gets its URL

The docs repo has no site configuration and no front matter, so `scripts/docs/mapping.ts` derives the published URL from the file path:

1. A page override in `url-overrides.json` wins (`{ "url": … }`, optionally with a `#fragment` when several files are sections of one live page; or `{ "exclude": "reason" }`).
2. Otherwise every path segment is slugified (lower case, non-alphanumerics become dashes).
3. An index page `Folder/folder.md` is published at the folder's URL.
4. The longest folder prefix with an entry in `folderAliases` is rewritten (SDK folders such as `Maps/Mobile SDKs/Android` become `maps/android-maps-sdk`; renamed APIs such as `Routing/Distance Matrix` become `routing/distance-matrix-api`).

The live sitemap is the source of truth. `npm run docs:validate` fails when a mapped URL is not in the snapshot, when a page is neither mapped nor explicitly excluded, when two pages share a URL without fragments, when an override points at a page that no longer exists, or when the committed reports are stale. Only pages that map to a live URL are indexed.

A page's `doc_id` is its slugified repo path without `.md`, independent of the URL (for example `routing/directions-api/examples/legal-routes-for-a-given-truck-weight`).

## Refreshing after a docs change (manual, by decision of 2026-10-07)

There is no scheduled refresh. When the docs change, an engineer runs the steps below, opens a PR, and the maintainer publishes a patch release.

```bash
# 1. Update the local clone of the docs repo
git -C ../nb-public-docs pull --ff-only

# 2. Refresh the pinned file list and the sitemap snapshot, regenerate the reports
cd packages/server
npm run docs:validate -- --docs ../../../nb-public-docs --fetch-sitemap --write

# 3. Fix anything the validator reports (new or renamed pages need an alias or an override),
#    then confirm check mode passes and tests are green
npm run docs:validate
npm test

# 4. Rebuild the packed index, copy it into the Claude Code plugin, run the retrieval eval
npm run docs:build-index -- --docs ../../../nb-public-docs
cd ../.. && npm run build && node scripts/sync-plugin-bundle.mjs && cd packages/server
npm run docs:eval -- --gate
# if the ranking changed on purpose (new pages, tuned synonyms), accept the new results:
npm run docs:eval -- --update-baseline

# 5. Bump the patch version (scripts/check-dist-versions.mjs lists every manifest), then open a PR
```

Review the diff of the two reports in the PR: a new entry in `files-without-urls.md` means a page was excluded, and growth in `urls-without-files.md` means the site gained pages the repo does not have.

## Eval set schema (`eval/questions.json`)

```jsonc
{
  "version": 1,
  "k": 5, // recall and MRR are computed over the top k results
  "questions": [
    {
      "id": "ext-01-4", // kebab-case, unique
      "split": "tuning", // "tuning" or "held_out"; boosts and synonyms are tuned on tuning only
      "source": "external-eval-2026-08", // where the question came from
      "queries": [
        // 2 to 3 variants, each kind at most once, "sentence" required; scored separately
        { "kind": "sentence", "text": "the question as a developer would type it" },
        { "kind": "keywords", "text": "distilled search terms" },
        { "kind": "paraphrase", "text": "the same question in other words" },
      ],
      "expected_doc_ids": ["places/geocoding/batch-geocode/batch-geocode"], // published pages only
      "match": "any", // "any" (default): one expected page in the top k is a hit; "all": every page must be
      "expected_related_tools": ["geocode_batch"], // optional; names of served tools
      "notes": "optional",
    },
  ],
}
```

`npm run docs:eval-check` validates the file against the published pages and the served tools. `npm run docs:eval` drives `search_documentation` through a real MCP client and reports recall@k and MRR per split and per variant kind; `--gate` applies the CI thresholds on the held-out split (recall@5 ≥ 0.90, MRR ≥ 0.75) and `--stdio` runs against the built bundle instead of an in-process server.

Tuning rule: boosts, synonyms (`src/docs/synonyms.ts`) and stemming are tuned on the tuning split only. The first synonym set (2026-10-07) was seeded from misses across both splits, so the held-out numbers from that date are optimistic by a few points; everything after that follows the rule.

## Index file (`../data/docs-index.json`)

Also holds the request parameters extracted from the reference pages' tables (`scripts/docs/parameters.ts`): the `| Name | Required | Format and Usage | Description |` query-parameter layout, `| Field | Type | Description |` request bodies and the `| Parameter | Type / Location | Description |` guide layout. Response tables and SDK pages are skipped. The endpoint id is `<api-slug>[/<variant>]`, with the variant taken from the page slug and the non-generic headings above the table (`directions/flexible`, `distance-matrix/asynchronous-fast`, `geofence/create`). Units are taken only from the docs' wording ("in seconds", "unix timestamp"); `null` otherwise.

Built by `npm run docs:build-index -- --docs <clone>` from the pinned commit; deterministic for a given commit. Plain chunks with page metadata, no prebuilt term index (ranking changes do not need a docs rebuild). The server resolves it at `../data/docs-index.json` relative to its bundle, which holds for the npm package, the Claude Code plugin (`distributions/claude-code/data/`, kept in sync by `scripts/sync-plugin-bundle.mjs`) and the Claude Desktop extension (staged by `scripts/build-mcpb.mjs`). `NBAI_DOCS_INDEX=<path>` overrides the location (tests and experiments only).
