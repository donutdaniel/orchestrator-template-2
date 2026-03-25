# AgentSpec Bundles

Canonical `v2alpha1` bundle shapes for common workspace setups. These shapes are the reference
contract for starter repositories such as `dho-labs/orchestrator-template` and its successors.

Every bundle must include exactly one `Workspace` resource at `agentspec/workspace.yaml`.

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Workspace
metadata:
  key: workspace
spec:
  git:
    defaultAutonomyMode: human-review
  toolPolicy:
    preset: supervised
```

## Single-Repo Product Workspace

Use when one product repo owns the application and the default executor handles nearly all work.

```text
agentspec/
├── workspace.yaml
├── environments/
│   └── default.yaml
├── agents/
│   ├── orchestrator.yaml
│   └── executor.yaml
├── skills/
│   └── code-review/
│       ├── skill.yaml
│       └── SKILL.md
├── tools/
│   ├── builtins.yaml
│   └── find-bugs.yaml
└── automations/
    └── triage-issues.yaml
```

Recommended defaults:

- Use `workspace.yaml` for shared git defaults, task defaults, tool policy, and prune policy
- One default `Environment` with the minimum required secret keys
- One default `Agent` per role
- Declare builtin and local tools explicitly
- Keep verification guidance in prompts, skills, and repo docs rather than declarative workflow steps

## Multi-Repo Engineering Workspace

Use when orchestration spans several product or service repositories and repo targeting varies by
task or automation.

```text
agentspec/
├── workspace.yaml
├── environments/
│   ├── dev.yaml
│   └── staging.yaml
├── agents/
│   ├── orchestrator.yaml
│   ├── executor.yaml
│   └── executor-thorough.yaml
├── skills/
│   ├── code-review/
│   │   ├── skill.yaml
│   │   └── SKILL.md
│   └── incident-intake/
│       ├── skill.yaml
│       └── SKILL.md
├── tools/
│   ├── builtins.yaml
│   ├── github-maintainer.yaml
│   └── incident-lookup.yaml
└── automations/
    └── incident-intake.yaml
```

Recommended defaults:

- Use `workspace.yaml` for shared autonomy defaults and reusable permission rules
- Use specialized `Agent` definitions for verification-heavy or review-heavy tasks
- Route automations to specific repositories with `target.repo` when needed
- Keep connector credentials in environment secrets, never in connector bindings
