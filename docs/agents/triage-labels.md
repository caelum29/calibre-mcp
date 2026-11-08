# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Priority labels

Added 2026-11-08. Every issue gets one, alongside its type label (`bug` / `enhancement`). Milestones are for waves and themes only, since an issue can sit in just one milestone.

| Label | Meaning |
| ----- | ------- |
| `P0`  | Critical: breaks core flows or loses data |
| `P1`  | High: wrong or misleading behavior, fix next |
| `P2`  | Normal: polish, low impact |
