# pi-extension-smart-edit

A [pi](https://github.com/badlogic/pi) extension that overrides the built-in `edit` tool with whitespace-tolerant matching. Designed for local LLMs that struggle with exact indentation.

## Problem

Local/quantized LLMs (e.g., Qwen 3.5 35B-A3B INT4) frequently fail the built-in `edit` tool because they can't reproduce exact whitespace — off-by-one indentation, tabs vs spaces, trailing whitespace. This leads to edit failure spirals: fail → retry → fail again → fall back to full file rewrites (wasting tokens).

## Solution

Smart-edit uses a 3-tier matching strategy:

1. **Exact match** — same as built-in (fast path)
2. **Whitespace-normalized match** — strips all leading/trailing whitespace per line, matches on content only
3. **Prettier-normalized match** — runs prettier on the file, then matches against formatted content

After a fuzzy replacement, prettier formats the result to ensure consistent style.

## Install

```bash
pi install /path/to/pi-extension-smart-edit
```

Or for quick testing:

```bash
pi -e /path/to/pi-extension-smart-edit/src/index.ts
```

## Test

```bash
npm test
```

## How it works

- Overrides the `edit` tool via `pi.registerTool({ name: "edit", ... })`
- Uses `withFileMutationQueue` for safe concurrent edits
- Runs prettier via JS API (bundled dependency) — respects project `.prettierrc`
- Falls back gracefully: unsupported file types use whitespace normalization only
- Syntax errors in model output fall back to whitespace normalization

## Token savings

| Scenario | Tokens |
|----------|--------|
| Successful edit (smart-edit) | ~10-20 |
| Failed edit + full file rewrite | ~200+ |
| Failed edit spiral (3 retries) | ~500+ |
