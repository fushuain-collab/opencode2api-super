# Refactoring Skill

When refactoring code:
- Make behavior-preserving changes only — no feature additions during refactor
- Refactor in small steps: extract → rename → simplify → move
- Prefer clarity over cleverness
- Remove dead code and unused imports
- Replace magic numbers/strings with named constants
- Functions should do one thing; if you need "and" to describe it, split it
- Keep diffs minimal — don't reformat unrelated lines
