# Provenance

`SKILL.md` is a verbatim copy of `skills/taste-skill/SKILL.md` from:

- Repo: https://github.com/nxpatterns/claude-taste-skill
- Commit: c8075169cd63d1430bbf492dd4ddd478ea9fa4da
- Installed: 2026-09-23

It is unmodified so it can be diffed against upstream.

## Project overrides

This project pins a design system (`DESIGN.md`, Cal.com via awesome-design-md)
which the specification cites as a deliberate choice. Where the skill's Section 1
baseline dials conflict with that pinned brief, the brief wins — which is what
the skill itself instructs ("ALWAYS listen to the user: adapt these values
dynamically based on what they explicitly request").

Dials used here, and why they differ from the 8/6/4 default:

| Dial | Default | Here | Reason |
|---|---|---|---|
| DESIGN_VARIANCE | 8 | 4 | Cal.com is a calm, symmetrical scheduling UI. Asymmetry would fight a dense time grid. |
| MOTION_INTENSITY | 6 | 3 | `globals.css` documents a deliberate reduced-motion policy. Perpetual loops would contradict it and add a framer-motion dependency the spec does not justify. |
| VISUAL_DENSITY | 4 | 5 | Schedule data is denser than a marketing page. |

Rules applied in full: dependency verification, anti-emoji, grid-over-flex-math,
viewport stability, tactile `:active` feedback, skeleton loaders, form patterns,
anti-slop content, z-index restraint, hardware-accelerated transforms only.

Rules deliberately overridden: the flat Inter ban (retained for body/UI text, as
`DESIGN.md` specifies it; display type moved to a geometric face, see below),
`rounded-[2.5rem]` and `#f9fafb` surfaces (the brief pins 12px and `#ffffff`).
