# Output Modes

Find OSS Alternative should keep one source of truth and render different outputs
from it. Do not let the chat summary, HTML dashboard, and video tell different
stories.

## Chat Brief

Use by default.

Include:

- Intent
- Best precedents
- Why they match
- `Use / Borrow / Avoid / Build New`
- Credits and license notes
- Next implementation constraints

## Precedent Report

Use when the user needs a durable handoff.

Recommended sections:

```text
Request
Intent
Query Families
Skill Precedents
Repo Precedents
Product / Community Precedents
Deep-Read Notes
Practical Lessons
Use / Borrow / Avoid / Build New
Credits & Licenses
Implementation Constraints
Next Steps
```

## HTML Dashboard

Use when there are enough candidates that a visual comparison helps.

Trigger when:

- 5 or more strong candidates were found.
- The user wants to share with a team.
- Another agent will continue the implementation.
- There is a clear ranking and decision matrix.

Generate a single local HTML file. Keep it dependency-free and readable from the
filesystem.

```bash
node scripts/render-html-report.mjs --input examples/typeless-report.json --out outputs/report.html
```

## Precedent Reel

Use when the result should be shared publicly or demoed.

Recommended structure:

```text
1. User idea
2. Query expansion
3. Evidence lanes
4. Ranked precedents
5. Implementation lessons
6. Use / Borrow / Avoid / Build New
7. Final recommendation
```

Choose the video tool by fit, not by default.

- **HyperFrames**: use for fast HTML-first reels, animated report walkthroughs,
  captions, narration, and social sharing. It is usually the best choice when
  the source report is already an HTML dashboard or structured JSON.
- **Remotion**: use for React-first video projects, reusable video templates,
  parameterized compositions, stronger asset pipelines, or a long-term
  programmatic video system.
- **Neither available**: state that video generation is not available in the
  current environment. Keep the candidate JSON and HTML dashboard as the source
  of truth, and provide a storyboard only when useful.

If the user names HyperFrames or Remotion, use the named tool unless it is not
available.

## Candidate JSON

Use when a downstream agent should continue from the same evidence.

The JSON should include:

- intent
- query families
- candidates
- scores
- decisions
- credits
- license notes
- generated outputs

See [precedent-report.schema.json](../templates/precedent-report.schema.json).
