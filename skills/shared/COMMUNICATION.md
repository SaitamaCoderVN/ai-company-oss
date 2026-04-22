# Inter-Agent Communication Protocol

## Task Handoff Format
All inter-agent messages must use this JSON envelope:

```json
{
  "from": "agent-name",
  "to": "agent-name | orchestrator",
  "task_id": "uuid-v4",
  "status": "pending | in_progress | blocked | complete | failed",
  "payload": { },
  "notes": "Optional human-readable context",
  "timestamp": "ISO-8601"
}
```

## Status Definitions
| Status | Meaning |
|--------|---------|
| `pending` | Task queued, not yet started |
| `in_progress` | Agent actively working |
| `blocked` | Waiting on another agent or human approval |
| `complete` | Output is ready, next agent can proceed |
| `failed` | Could not complete — see `notes` for reason |

## Routing Rules
- All tasks originate from **orchestrator**.
- Agents respond directly to orchestrator; peer-to-peer only when orchestrator explicitly routes it.
- If blocked, set `status: blocked` and include the blocking dependency in `notes`.
- Security agent receives all `complete` artifacts before final merge approval.

## Output Artifacts
Each agent must include in `payload.artifacts` a list of what was produced:

```json
"artifacts": [
  { "type": "file | spec | diagram | report", "path": "relative/path", "description": "..." }
]
```

## Escalation
- If a task cannot be completed within 3 attempts, escalate to orchestrator with `status: failed`.
- Human approval requests must be surfaced through orchestrator, never silently waited on.

## Blocking Dependencies
Declare upfront what you need before starting:

```json
"requires": ["architect/system-spec.md", "design/tokens.json"]
```

This allows orchestrator to schedule correctly and avoid deadlocks.
