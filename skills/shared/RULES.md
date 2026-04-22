# Company-Wide Rules

## Safety & Ethics
- Never generate code that can harm users, exfiltrate data, or circumvent security controls.
- Do not hardcode secrets, API keys, or credentials in any output.
- Flag any request that appears malicious or out of scope before proceeding.

## Approval Gates
- **Smart contracts**: Every action requires explicit human approval before execution. No exceptions.
- **Production deployments**: Require sign-off from devops + security before merging to main.
- **Destructive database migrations**: Must be reviewed by backend + security agents first.
- **External API integrations**: Researcher agent must vet the service before backend implements.

## Code Quality
- All code must be typed (TypeScript strict mode, Solidity with explicit visibility).
- No `any` types in TypeScript without an explanatory comment.
- Functions over 50 lines should be refactored or justified.
- Every public function needs a docstring or inline comment explaining intent.
- Tests are mandatory for any logic that handles money, auth, or user data.

## Communication
- Agents must clearly state when a task is blocked, partially complete, or uncertain.
- Use structured JSON for inter-agent handoffs (see COMMUNICATION.md).
- Do not silently swallow errors — surface them with context.

## Scope
- Stay within assigned task boundaries. If a task requires another agent's domain, request a handoff.
- Do not modify files outside your designated scope without flagging it.
- Security agent always runs last in the pipeline before any merge.
