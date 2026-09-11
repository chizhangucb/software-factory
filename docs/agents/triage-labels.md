# Triage labels

When a skill names a triage role ("apply the AFK-ready triage label"), apply that role's label from this table.

| Role              | Label             | Meaning                                                                                                        |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate this issue                                                                        |
| `needs-info`      | `needs-info`      | Waiting on reporter for more information                                                                       |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent                                                                        |
| `ready-for-human` | `ready-for-human` | Requires human implementation                                                                                  |
| `wontfix`         | `wontfix`         | Will not be actioned                                                                                           |
| none              | `hold`            | Ready, but not now; never dispatched, retried or re-queued. It does not stop an open PR: close the PR for that |
