# Credits and Licenses

Find OSS Alternative must make attribution and license compatibility visible. The
skill name is provocative, but the behavior must be clean.

## Required Credits Block

Every final answer must include a compact credits block when repos influenced
the recommendation.

```text
Credits & License Notes

- Open-Less/openless: closest product reference. MIT.
- TypeWhisper/typewhisper-mac: local engine/plugin reference. GPL-3.0.
- hehehai/voxt: app-aware prompt routing reference. License needs review.

Direct code reuse requires license compatibility and preserved attribution.
If compatibility is unclear, borrow ideas only.
```

## Decision Rules

- MIT / Apache-2.0 / BSD: usually compatible with permissive reuse, but preserve
  notices and attribution.
- GPL / AGPL / LGPL: do not copy code into a proprietary or incompatible project
  without human review.
- No license / unknown license: do not copy code. Treat as inspiration only.
- Mixed-license repo: inspect the relevant files before reuse.

## What Agents Should Credit

Credit a repo when it influenced:

- Product scope
- User workflow
- Architecture
- Module boundaries
- API shape
- Protocol/model design
- Implementation pattern
- Visual or interaction pattern

## What Agents Must Not Do

- Do not copy private or leaked code.
- Do not bypass access controls.
- Do not hide provenance.
- Do not remove license headers.
- Do not present another repo's design as original.
- Do not copy code from unclear-license repos into production.

## Good Language

Use:

```text
Borrow the app-aware prompt routing pattern from Voxt.
Study OpenLess as the closest full-product reference.
Do not copy TypeWhisper code directly unless GPL compatibility is intended.
```

Avoid:

```text
Copy this repo into our product.
Ignore the license because it is public.
This is open source, so attribution is optional.
```
