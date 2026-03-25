# orchestrator-template

Starter agentspace repository that follows the current AgentSpec layout used by Orchestrator.

## What this template includes

- `agentspec/` with starter specs for workspace, environments, agents, skills, tools, and automations
- `prompts/` with role prompts (`orchestrator`, `executor`)
- `tools/` for custom tool implementations
- `reference/agentspec.md` with the full AgentSpec reference
- `reference/agentspec-bundles.md` with canonical bundle shapes

## Quick start

1. Review `agentspec/workspace.yaml` for workspace-level defaults (autonomy mode, tool policy).
2. Set required secret keys in `agentspec/environments/default.yaml` to match your workspace secrets.
3. Adjust agent defaults in `agentspec/agents/*.yaml` (harness, model, prompt paths).
4. Define tool contracts in `agentspec/tools/*.yaml` (builtin/local/connector) and align them with runtime tools.
5. For local tools, set `spec.modulePath` to an existing `tools/*.tool.ts|js|mjs` module.
6. Update `agentspec/automations/triage-issues.yaml` with the right labels, `environmentKey`, and optional `target.repo`.
7. Remove or edit starter tool and automation examples before production use.
8. Commit and push. Reconcile applies this desired state in your workspace.

## Rules to keep valid

- Keep `apiVersion` as `agentspec.orchestrator.dev/v2alpha1`.
- `agentspec/workspace.yaml` is required and must use `metadata.key: workspace`.
- Keep `metadata.key` stable after creation. Renames should be delete + create.
- Exactly one default environment should be marked with `spec.isDefault: true`.
- Exactly one default agent definition per role should be marked with `spec.isDefault: true`.
- Prompt paths in agent specs must exist in `prompts/`.
- Repositories are not declared in agentspec. Connect them through GitHub, then target them from automations with `spec.target.repo` when needed.

## Starter keys and cross-references

- Workspace key: `workspace`
- Environment key: `default`
- Agent keys: `orchestrator`, `executor`
- Tool keys: `builtins`, `find-bugs`
- Automation key: `triage-issues`
- Skill key: `code-review`

If you change keys, update all references across files.
