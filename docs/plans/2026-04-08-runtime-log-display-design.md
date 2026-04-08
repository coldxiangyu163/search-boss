# Runtime Console Detailed Log UX Design

## Design recommendation
Treat logs as a three-level information structure:
1. **Recent key event** — already surfaced near the top
2. **Activity feed** — operator-readable milestone stream
3. **Raw detail** — still present, but visually demoted

## Recommended interaction model
- Keep logs collapsed by default.
- Replace the current placeholder copy with a compact summary row: total events + whether there are warnings/errors + current stage.
- When expanded, show a structured activity feed where each row has:
  - status dot/icon
  - event label
  - stage badge
  - timestamp
  - human message
- Prioritize milestone/warning/error rows above plain stream rows.
- De-emphasize noisy nanobot stream lines via lighter styling and grouping.

## Product rationale
Operators do not want “all logs”; they want confidence. The feed should answer:
- did the task advance?
- did anything go wrong?
- what changed most recently?
- do I need to act now?

## Visual direction
- light background, consistent with current console shell
- card/feed rows instead of terminal slab
- severity color only where it adds meaning
- fewer monospace blocks; use product typography for labels and messages
