---
name: fabric-implement-verify
description: Verifies and reviews an approved repository change for the built-in Fabric implement Program. Use only when the Program binds it explicitly.
---

# Verify actual repository state

- Inspect the actual diff and files; do not trust implementation summaries alone.
- Map every acceptance item and changed boundary to the smallest decisive behavioral check.
- Run repository-required final gates, including a fresh build when the repository requires one.
- Distinguish passed, failed, skipped, and unverified evidence explicitly.
- Report only material correctness, safety, contract, maintainability, or missing-test defects.
- Do not demand unrelated cleanup, generalized abstractions, or defenses against immaterial edge cases.
- Never edit during an independent verification or review stage.
