---
name: Responsive navigation override
description: The mobile shell's legacy sidebar rules can collapse a new navigation unless they are explicitly replaced.
---

Mobile navigation must explicitly replace the earlier sidebar horizontal-scroll rules at the final cascade layer; a fixed grid is safer than inheriting the desktop nav's width and flex behavior.

**Why:** The project already had broad mobile sidebar selectors that silently overrode a first pass at the labeled More navigation, leaving clipped and partially visible destinations at narrow widths.

**How to apply:** When changing the shell, inspect all earlier sidebar media queries and use a final narrow-width override with explicit display, width, overflow, and item sizing. Recheck 375px and 402px captures.