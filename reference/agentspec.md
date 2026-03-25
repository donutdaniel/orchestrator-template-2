# AgentSpec Reference

The agentspec is the set of declarative spec files that define the desired state of an
Orchestrator workspace. It lives in the `agentspec/` directory of an agentspace repository.

Both humans and agents author the agentspec. The reconciler treats all commits identically — autonomy
mode controls how commits land (direct push vs PR review), not what can be written.

## Agentspace Repository Layout

```
agentspace-repo/
├── agentspec/
│   ├── workspace.yaml
│   ├── environments/
│   │   └── *.yaml
│   ├── agents/
│   │   └── *.yaml
│   ├── skills/
│   │   └── <skill-key>/
│   │       ├── skill.yaml
│   │       ├── SKILL.md
│   │       └── <optional assets>
│   ├── connectors/
│   │   └── *.yaml
│   ├── tools/
│   │   └── *.yaml
│   └── automations/
│       └── *.yaml
├── prompts/
│   ├── orchestrator.md
│   └── executor.md
├── tools/
│   └── *.tool.{ts,js,mjs}
```

The `agentspec/` directory holds all spec files. Prompts and custom tools
live at the repo root as sibling directories — they are runtime content, not declarative specs.

## Declarative vs Runtime Content

AgentSpec models desired state that the reconciler can validate and project into runtime records.
Prompt Markdown and custom tool code are executable runtime artifacts, so AgentSpec stores pointers
and policy for them instead of inlining the content.

- `Agent.spec.promptPath` points to a prompt file committed in the agentspace repository.
- `Agent.spec.toolPolicy` and `Environment.spec.toolPolicy` control runtime permissions and
  approval behavior via the tool policy chain.
- `Tool` declares tool contracts (connector, local, or builtin) with schema/risk metadata.
- Local Tools (`spec.source=local`) point to runtime modules via `spec.modulePath`.
- `tools/*.tool.ts|js|mjs` defines repo-local custom runtime tools loaded at runtime.

This split is intentional:

1. Keep reconcile inputs deterministic and compact.
2. Keep executable artifacts in files (versioned, reviewable, testable) rather than projected state.
3. Allow prompt/tool iteration without changing AgentSpec schema shape.

### Implementation Notes (Current Runtime)

- Prompt files are required at reconcile time. Missing `spec.promptPath` defaults to `prompts/<role>.md`,
  and reconcile fails if the file is absent.
- Runtime prompt content is loaded from the pinned agentspace checkout at run start (commit-pinned provenance).
- Custom tool modules are loaded only from declared local Tools (`spec.source=local`) using
  `spec.modulePath`.
- `spec.modulePath` must reference an existing `*.tool.ts|js|mjs` file in the same agentspace commit.
- Repo custom tools are loaded for orchestrator and executor runs.
- Only Tool-declared local runtime tools are injected.
- Agent execution requires an explicit runtime prompt loaded from the agentspace repo; there is no
  in-code prompt fallback path.
- Legacy `delegator` agents and `Workflow` resources are removed. Sync fails until you delete
  old `agentspec/agents/delegator.yaml`, any `allowedRoles: [delegator]`, and
  `agentspec/workflows/*.yaml`.

### Minimal Agentspace Example

```text
agentspace-repo/
├── agentspec/
│   ├── workspace.yaml
│   ├── agents/
│   │   └── executor.yaml
│   └── tools/
│       └── summarize-workspace.yaml
├── prompts/
│   └── executor.md
├── tools/
│   └── summarize-workspace.tool.ts
```

`agentspec/workspace.yaml`

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

`agentspec/agents/executor.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Agent
metadata:
  key: executor
spec:
  role: executor
  isDefault: true
  agentHarness: codex
  model: gpt-5.4
  promptPath: prompts/executor.md
```

`agentspec/tools/summarize-workspace.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Tool
metadata:
  key: summarize-workspace
spec:
  source: local
  toolId: summarize_workspace
  modulePath: tools/summarize-workspace.tool.ts
  description: Summarize workspace status from orchestrator context.
  riskClass: read
```

`tools/summarize-workspace.tool.ts`

```ts
import { z } from "zod";

export default {
  id: "summarize_workspace",
  description: "Summarize workspace status from orchestrator context.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    summary: z.string(),
  }),
  run: async (input: { limit: number }) => ({
    summary: `Summarized ${input.limit} items.`,
  }),
};
```

For canonical bundle shapes, see [reference/agentspec-bundles.md](./agentspec-bundles.md).

## File Format

One resource per file. YAML with four top-level keys:

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Environment
metadata:
  key: dev
spec:
  isDefault: true
```

| Field                  | Description                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`           | Always `agentspec.orchestrator.dev/v2alpha1`.                                                                                                      |
| `kind`                 | Resource type. One of: `Workspace`, `Environment`, `Agent`, `Skill`, `Tool`, `Connector`, `Automation`.                                          |
| `metadata.key`         | Stable identity key for this resource. Immutable after creation — renaming means delete + create. Must be unique within its kind per workspace.    |
| `metadata.annotations` | Optional key-value pairs for lifecycle control (e.g., `orchestrator.dho.dev/prune: "true"`).                                                       |
| `spec`                 | Kind-specific fields (see below).                                                                                                                  |

`Workspace` is the only singleton resource. Every agentspace repository must include exactly one
`Workspace` document at `agentspec/workspace.yaml`, and it must use `metadata.key: workspace`.

## Projected Control Plane

Every agentspec-managed row carries the same minimal control-plane fields:

- `agentspecKey`
- `agentspecPath`
- `agentspecChecksum`
- `agentspecReconcileStatus`
- `agentspecPruneOnDelete`

`agentspecReconcileStatus` is the only projected lifecycle state:

- `ready` means the row matches the declared resource
- `degraded` means the row exists but runtime prerequisites are incomplete
- `orphaned` means the resource was removed from agentspec and intentionally retained

## Revision Model

Two workspace-level pointers track agentspec state:

- `desiredAgentSpecSha` — latest pushed commit SHA. Updated on push webhook, agent commit, or manual trigger.
- `activeAgentSpecSha` — last successfully reconciled commit SHA.

When `desired != active`, a reconcile is pending. On success, `active = desired`. On failure,
`active` stays at the last good SHA. Rollback by pushing a known-good commit.

## Manual Reconcile API

`POST /api/v1/workspaces/[id]/agentspec/reconcile`

Request body:

```json
{
  "sha": "optional-commit-sha",
  "dryRun": true
}
```

- `dryRun=true` compiles and validates the target SHA, then returns a deterministic plan with zero DB writes.
- `dryRun=false` (default) runs atomic apply. Any write failure rolls back the full apply transaction.

Response includes:

- `mode`: `"dry-run"` or `"apply"`
- `status`: `"dry-run" | "reconciled" | "skipped"`
- `plan` for dry-run
- `commitSha`, `eventId`

## Lifecycle

Resources removed from the agentspec are **orphaned by default** — retained in the database but
marked `orphaned` and excluded from declarative runtime selection. This prevents accidental
destruction of runtime state.

To opt into deletion:

- Per-resource: set annotation `orchestrator.dho.dev/prune: "true"` before removing the file
- Per-workspace: set `Workspace.spec.lifecycle.prunePolicy: enabled`

`Workspace` itself cannot be pruned. Removing `agentspec/workspace.yaml` is a validation error, not
a delete request.

## Reconcile Ordering

Within a single reconcile pass, resources are applied in dependency order:

1. Workspace (projects workspace defaults before any dependent resources)
2. Environments (no dependencies)
3. Skills (no dependencies)
4. Agent definitions (may reference environments)
6. Tools (connector tools may reference connectors; local/builtin tools are standalone)
7. Connectors (may reference environments and secret keys; project Tools into connector definitions and connectors)
8. Automations (may reference connectors and environments)

Within a tier, resources are applied in parallel.

---

## Workspace

Declares workspace-wide runtime defaults. This resource is required and singleton.

**File location:** `agentspec/workspace.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Workspace
metadata:
  key: workspace
spec:
  instructions: Prefer small, reviewable changes.
  git:
    defaultAutonomyMode: agent-review
  taskDefaults:
    maxTaskRetries: 1
    maxNestingDepth: 4
  toolPolicy:
    preset: supervised
  lifecycle:
    prunePolicy: enabled
```

### Fields

| Field                            | Type                                             | Required | Default            | Description                                                                                       |
| -------------------------------- | ------------------------------------------------ | -------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `spec.instructions`              | string                                           | No       | —                  | Workspace-level guidance projected into runtime workspace settings.                               |
| `spec.git.defaultAutonomyMode`   | `"full"` \| `"agent-review"` \| `"human-review"` | No       | `"human-review"`   | Workspace-level fallback git autonomy when repo and environment do not override it.              |
| `spec.taskDefaults.maxTaskRetries` | integer                                        | No       | `0`                | Default retry budget for tasks when project or task settings do not override it.                 |
| `spec.taskDefaults.maxNestingDepth` | integer                                       | No       | `3`                | Default maximum nesting depth for projects and tasks when no narrower override exists.           |
| `spec.toolPolicy`                | `ToolPolicy`                                     | No       | `"supervised"` | Workspace permission baseline and reusable rules.                                                 |
| `spec.lifecycle.prunePolicy`     | `"enabled"` \| `"disabled"`                      | No       | `"disabled"`       | Workspace-wide orphan handling for removed agentspec resources.                                   |

### Projection Contract

- `spec.instructions` -> `workspaces.settings.instructions`
- `spec.git.defaultAutonomyMode` -> `workspaces.settings.agentspec.defaultAutonomyMode`
- `spec.taskDefaults.maxTaskRetries` -> `workspaces.settings.maxTaskRetries`
- `spec.taskDefaults.maxNestingDepth` -> `workspaces.settings.maxNestingDepth`
- `spec.toolPolicy` -> `workspaces.settings.toolPolicy`
- `spec.lifecycle.prunePolicy` -> `workspaces.settings.agentspec.prunePolicy`

Runtime services still read the projected `workspaces` row, but declarative fields are authored in
`agentspec/workspace.yaml`. Workspace display metadata such as `name` and `description` are edited
directly in the UI and are not part of the agentspec contract.

### Identity And Lifecycle

- `metadata.key` is fixed to `workspace`
- `agentspec/workspace.yaml` is required for every compile/reconcile
- removing the file is invalid; there is no workspace delete-or-orphan flow in agentspec

### Runtime State (DB-only, not in agentspec)

- Workspace `id`, `shortId`, and organization linkage
- Agentspace repo attachment and active/default branch metadata
- Secrets, approval history, reconcile history, and other operational state
- Runtime connector enablement/binding state

---

## Repositories

Repositories are **not** declared in agentspec. They are auto-populated into `github_repositories`
when the GitHub App is installed or repositories are added to an installation. Automations can
target a specific repo via `target.repo` using the `owner/repo` fullName format.

### Runtime State (DB-only)

- Repository rows (`github_repositories`) — auto-populated from GitHub App webhooks
- GitHub installation linkage (`githubInstallationId` on each GitHub repository)
- Agentspace repo attachment (`agentspaces_repos.githubRepositoryId`)

---

## Environment

Declares an execution environment with network policy, tool policy overlays, and secret key
requirements. Secret values are never in the agentspec — only the key names that must be present.

**File location:** `agentspec/environments/<key>.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Environment
metadata:
  key: dev
spec:
  name: Development
  isDefault: true
  networkPolicy:
    egressMode: allowlist
    allowedDomains:
      - api.openai.com
      - api.anthropic.com
  secrets:
    requiredKeys:
      - REDIS_URL
  toolPolicy:
    preset: supervised
    rules:
      - action: deny
        selector:
          kind: tool_pattern
          pattern: bash
      - action: ask
        selector:
          kind: browser
          origin: https://github.com
```

### Fields

| Field                               | Type                                             | Required | Default                 | Description                                                                                         |
| ----------------------------------- | ------------------------------------------------ | -------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `spec.name`                         | string                                           | No       | Value of `metadata.key` | Display name.                                                                                       |
| `spec.isDefault`                    | boolean                                          | No       | `false`                 | Whether this is the default environment for the workspace. Exactly one environment must be default. |
| `spec.networkPolicy.egressMode`     | `"allowlist"` \| `"denylist"` \| `"open"`        | No       | `"open"`                | Network egress policy mode.                                                                         |
| `spec.networkPolicy.allowedDomains` | string[]                                         | No       | `[]`                    | Domains allowed for egress (only when `egressMode: allowlist`).                                     |
| `spec.networkPolicy.deniedDomains`  | string[]                                         | No       | `[]`                    | Domains blocked for egress (only when `egressMode: denylist`).                                      |
| `spec.secrets.requiredKeys`         | string[]                                         | No       | `[]`                    | Secret key names that must have values set in the database before runs can use this environment.    |
| `spec.toolPolicy.preset`            | `"supervised"` \| `"autonomous"` | No       | `"supervised"`     | Baseline permission preset for the environment.                                                      |
| `spec.toolPolicy.rules`             | `ToolPolicyRule[]`                               | No       | `[]`                    | Ordered overrides that `allow`, `ask`, or `deny` matching tool invocations.                         |
| `spec.autonomyMode`                 | `"full"` \| `"agent-review"` \| `"human-review"` | No       | Inherited               | Environment-level git autonomy override.                                                            |

### Tool Policy Chain

Tool policies resolve through a chain: **Workspace → Environment → Agent Definition**. Each layer
can set a preset and/or rules. The most specific preset wins (last in chain). Rules accumulate
across all layers and are evaluated in order; last matching rule wins.

Additionally, the agentspec's Tool declarations generate implicit **deny** rules for any builtin
tools not declared — this is a constraint, not a policy layer, and never sets a preset.

`toolPolicy.rules` selectors can target:

- tool patterns (`{ kind: "tool_pattern", pattern: "browser_*" }`)
- bash command prefixes
- filesystem paths scoped to tool IDs
- connector calls (`connectorId`, `toolId`, `method`, `pathPrefix`, `operationType`)
- browser origins

### Runtime State (DB-only, not in agentspec)

- Encrypted secret values (`environment_secrets` table)
- Secret rotation timestamps
- Runtime status and usage telemetry
- Execution readiness: required secret keys must resolve before any runner can spawn in the environment
- Sandbox egress enforcement: network policy filters dynamic outbound hosts at runner start

---

## Agent

Declares agent defaults for a specific role — model, harness, prompt path, and tool policy.
Multiple agent definitions per role are supported; one must be designated as the default.

**File location:** `agentspec/agents/<key>.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Agent
metadata:
  key: executor-default
spec:
  role: executor
  isDefault: true
  agentHarness: claude-code
  model: claude-sonnet-4-6
  promptPath: prompts/executor.md
  toolPolicy:
    preset: supervised
    rules:
      - action: allow
        selector:
          kind: tool_pattern
          pattern: read_*
      - action: ask
        selector:
          kind: command
          toolId: bash
          prefix: git status
```

### Fields

| Field                   | Type                                                        | Required | Default             | Description                                                                                               |
| ----------------------- | ----------------------------------------------------------- | -------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `spec.role`             | `"orchestrator"` \| `"executor"`                            | Yes      | —                   | Agent role this definition applies to.                                                                    |
| `spec.isDefault`        | boolean                                                     | No       | `false`             | Whether this is the default agent definition for its role. Exactly one agent definition per role must be default. |
| `spec.agentHarness`     | `"general"` \| `"claude-code"` \| `"codex"` \| `"opencode"` | No       | `"general"`         | Runtime harness. `orchestrator` must use `general`. `executor` can use any value.                         |
| `spec.model`            | string                                                      | No       | Per-harness default | Model identifier. Must be valid for the selected harness.                                                 |
| `spec.promptPath`       | string                                                      | No       | `prompts/<role>.md` | Path to the prompt file, relative to agentspace repo root. File must exist.                               |
| `spec.toolPolicy.preset` | `"supervised"` \| `"autonomous"` | No       | `"supervised"` | Baseline permission preset for this runtime.                                                              |
| `spec.toolPolicy.rules`  | `ToolPolicyRule[]`                                       | No       | `[]`                | Ordered allow/ask/deny overrides evaluated after the preset baseline.                                     |

### Harness Constraints

| Harness       | Roles                             | Available Models                                                                                                                     |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `general`     | orchestrator, executor            | `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`, `gpt-5.4`, `gpt-5-codex`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5-mini`, `gpt-5-nano` |
| `claude-code` | executor only                     | `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`                                                         |
| `codex`       | executor only                     | `gpt-5.4`, `gpt-5-codex`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5-mini`, `gpt-5-nano`                                       |
| `opencode`    | executor only                     | `claude-sonnet-4-6`, `claude-opus-4-6`, `gpt-5.4`, `gpt-5.2`, `gpt-5-mini`, `gpt-5-nano`                                    |

### Override Hierarchy

When resolving agent config for a run:

1. **Run request** — most specific, wins if set
2. **Agent definition default** — inherited if run request omits the field

Workspace policy enforces the ceiling. A run request for `model: claude-opus-4-6` is rejected if
workspace policy caps at `claude-sonnet-4-6`.

### Runtime State (DB-only, not in agentspec)

- Projected agent definitions (`agent_definitions`) used by run creation
- Run-level provenance (selected agent key, pinned agentspec SHA)
- Execution state (runs, activities, outcomes)

---

## Skill

Declares a skill — reusable procedural knowledge that agents can invoke during execution. Skills
are a primary surface for agent-authored content. Unlike other resource types, skills do not require
DB projection — runtime loads them directly from the pinned agentspec checkout.

**File location:** `agentspec/skills/<key>/skill.yaml` (with `SKILL.md` alongside)

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Skill
metadata:
  key: code-review
spec:
  name: Code Review
  description: Reviews pull requests for bugs, security issues, and style.
  tags:
    - review
    - quality
  contentRoot: .
  exposurePolicy:
    scope: workspace
    allowedRoles:
      - executor
```

### Fields

| Field                              | Type                        | Required | Default       | Description                                                                                                                                                                   |
| ---------------------------------- | --------------------------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.name`                        | string                      | Yes      | —             | Human-readable skill name.                                                                                                                                                    |
| `spec.description`                 | string                      | Yes      | —             | What the skill does.                                                                                                                                                          |
| `spec.tags`                        | string[]                    | No       | `[]`          | Tags for categorization and discovery.                                                                                                                                        |
| `spec.contentRoot`                 | string                      | No       | `"."`         | Directory containing skill content, relative to the skill.yaml file.                                                                                                          |
| `spec.exposurePolicy.scope`        | `"workspace"`               | No       | `"workspace"` | Visibility scope. Cross-workspace `global` exposure is not part of the current runtime contract.                                                                              |
| `spec.exposurePolicy.allowedRoles` | string[]                    | No       | All roles     | Which agent roles can use this skill.                                                                                                                                         |
| `spec.source`                      | string                      | No       | —             | External source reference for shared skills (e.g., `github.com/org/shared-skills/code-review@v1.0`). If set, skill content is resolved from this reference at reconcile time. |

### Skill Content Structure

```
agentspec/skills/code-review/
├── skill.yaml          # Skill metadata
├── SKILL.md            # Skill instructions (required)
└── references/         # Optional supporting files
    └── checklist.md
```

The `SKILL.md` file is the primary skill content that agents read. Additional files in the content
root are available as references.

### Size Limits

- Warn at 500KB per skill
- Hard fail at 1MB per skill

### Shared Skills

Skills can be imported by reference using `spec.source`. The reconciler resolves the reference at
reconcile time and pins the resolved content SHA. The resolved content is cached locally.

### Runtime Behavior

Skills are loaded directly from the pinned agentspec checkout — no DB projection required. An
optional in-memory cache keyed by commit SHA is allowed for performance.

---

## Connector

Declares an external runtime connector for the workspace. `Connector` is the only creation
surface for runtime connectors. Tool contracts are declared separately via `Tool`.

**File location:** `agentspec/connectors/<key>.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Connector
metadata:
  key: my-mcp-server
spec:
  provider: mcp
  credentials:
    secretKeys:
      - MCP_SERVER_API_KEY
```

### Fields

| Field                         | Type     | Required | Default | Description                                                                                                  |
| ----------------------------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `spec.provider`               | string   | Yes      | —       | Runtime connector provider identifier (e.g., `mcp`, `custom_api`).                                         |
| `spec.credentials.secretKeys` | string[] | No       | `[]`    | Environment secret keys required by this connector. The values are resolved only from `environment_secrets`. |
| `spec.webhook.enabled`        | boolean  | No       | `false` | Whether this connector receives webhook events.                                                              |
| `spec.webhook.events`         | string[] | No       | `[]`    | Event types this connector subscribes to.                                                                    |

### Typed vs Generic Adapters

- **MCP Server** connectors (`provider: mcp` or `mcp_server`) expose remote MCP tools at runtime.
- **Custom API** connectors (`provider: custom_api`) provide configurable auth and webhook-in/API-out.
- GitHub is not part of `Connector`. Repository access and app installs are modeled
  separately as source-control bindings.

### Runtime State (DB-only, not in agentspec)

- Connector metadata and projected tool definitions (`connector_definitions`)
- Connector instances and prerequisite status (`connectors`)
- User-scoped OAuth accounts such as OpenAI (`user_accounts`)
- Approval records and audit logs
- Environment secret values (`environment_secrets`)

### Reconcile Behavior

Each `Connector` creates or updates:

- one `connector_definitions` row that stores provider metadata, tool definitions, webhook config,
  and required secret keys
- one `connectors` row that stores workspace binding state, non-secret identifiers, and
  prerequisite status

Connector creation is never blocked by missing secrets. Reconcile materializes the connector and
marks it `pending_prereqs` until environment secrets and any required non-secret bindings are
present.

---

## Tool

Declares a tool contract. Tools can model:

- connector-backed tools (projected into runtime connector tool definitions),
- repo-local runtime tools, and
- builtin runtime tools.

**File location:** `agentspec/tools/<key>.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Tool
metadata:
  key: mcp-query
spec:
  source: connector
  connectorKey: my-mcp-server
  toolId: query
  name: Query
  description: Run a query against the connected MCP server.
  riskClass: read
```

### Fields

| Field                        | Type                                                                      | Required    | Default         | Description                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------- | ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `spec.source`                | `"connector"` \| `"local"` \| `"builtin"`                                 | No          | `"connector"`   | Tool source plane.                                                                                                   |
| `spec.connectorKey`          | string                                                                    | Conditional | —               | Required when `spec.source=connector`. Must reference an existing `Connector` key.                                  |
| `spec.modulePath`            | string                                                                    | Conditional | —               | Required when `spec.source=local`. Repo-relative path to a `*.tool.ts`, `*.tool.js`, or `*.tool.mjs` runtime module. |
| `spec.toolId`                | string                                                                    | Yes         | —               | Runtime tool identifier within the selected source plane.                                                            |
| `spec.name`                  | string                                                                    | No          | `spec.toolId`   | Human-readable tool name.                                                                                            |
| `spec.description`           | string                                                                    | Yes         | —               | Human-readable description shown to the agent.                                                                       |
| `spec.riskClass`             | `"read"` \| `"write_reversible"` \| `"write_irreversible"` \| `"unknown"` | No          | Derived         | Explicit tool risk classification.                                                                                   |
| `spec.writeApprovalRequired` | boolean                                                                   | No          | `true`          | Convenience risk toggle. `false` maps to `riskClass=read`, otherwise `write_irreversible`.                           |
| `spec.inputSchema`           | object                                                                    | No          | —               | JSON-schema-like hint surfaced to runtime/tool UIs.                                                                  |
| `spec.annotations`           | object                                                                    | No          | —               | Additional non-sensitive tool metadata.                                                                              |
| `spec.method`                | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"`                 | No          | —               | Optional HTTP method hint (useful for dynamic/custom API connectors).                                                |
| `spec.path`                  | string                                                                    | No          | —               | Optional API path hint (useful for dynamic/custom API connectors).                                                   |
| `spec.remoteToolName`        | string                                                                    | No          | —               | Optional remote MCP tool identifier hint.                                                                            |

### Risk Resolution

- If `spec.riskClass` is set, it wins.
- Otherwise `spec.writeApprovalRequired: false` maps to `read`.
- Otherwise the default is `write_irreversible`.
- Do not set both `spec.riskClass` and `spec.writeApprovalRequired` in the same Tool.

### Runtime Behavior

- Connector Tools (`spec.source=connector`) are grouped by `spec.connectorKey`.
- The reconciler projects grouped connector Tools into the target `Connector`
  connector definition tool set.
- Any connector Tool change updates the owning connector's projected checksum, so reconcile detects drift.
- Local/builtin Tools are validated and tracked as declarative tool metadata but are not
  projected into runtime connectors.
- Builtin Tools are validated against the canonical built-in tool registry (`packages/constants/src/runtime-tools.ts`).
- Use `toolId: "*"` to allow all builtin tools without listing each one individually. Any other `toolId` must match an entry in the registry.
- Builtin runtime tools are always available — agentspec tool declarations are additive (grant connector/local tools), not restrictive for builtins.
- Local Tools are explicit runtime bindings: each declared local tool ID maps to exactly one declared module path, and only those modules are loaded.

---

## Automation

Declares an automation — a trigger-to-task rule that creates work in response to events.

**File location:** `agentspec/automations/<key>.yaml`

```yaml
apiVersion: agentspec.orchestrator.dev/v2alpha1
kind: Automation
metadata:
  key: triage-issues
spec:
  name: Triage New Issues
  description: Automatically triage and label new GitHub issues.
  trigger:
    type: github_issue_label
    config:
      labels:
        - bug
        - triage
      excludeLabels:
        - wontfix
  target:
    environmentKey: dev
    repo: acme/platform
```

### Fields

| Field                        | Type   | Required | Default                    | Description                                                                                     |
| ---------------------------- | ------ | -------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `spec.name`                  | string | Yes      | —                          | Human-readable automation name.                                                                 |
| `spec.description`           | string | No       | —                          | What this automation does.                                                                      |
| `spec.trigger.type`          | string | Yes      | —                          | Trigger type. See trigger types below.                                                          |
| `spec.trigger.config`        | object | Yes      | —                          | Trigger-specific configuration. Schema depends on `trigger.type`.                               |
| `spec.target.environmentKey` | string | No       | Default environment        | Environment to run in. Must reference an existing `Environment` key.                            |
| `spec.target.repo`           | string | No       | —                          | Repository fullName (`owner/repo`) for the task. Must exist in workspace `github_repositories`. |
| `spec.connectorKey`          | string | No       | —                          | Runtime connector that provides the trigger events when the trigger comes from a runtime connector. Must reference an existing `Connector` key. Reconcile stores the resolved connector on `automations.connectorId`. |

### Trigger Types

| Type                 | Config Fields                                                                              | Description                                                 |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `github_issue_label` | `labels: string[]`, `excludeLabels?: string[]`                                             | Fires when a GitHub issue is labeled with a matching label. Repo resolved from the webhook event payload. |
| `cron`               | `schedule: string`, `prompt: string`                                                       | Fires on a cron schedule with a fixed prompt.               |
| `sentry_exception`   | `minLevel: "error" \| "warning" \| "info"`, `excludePatterns?: string[]`                   | Fires on Sentry exceptions at or above the minimum level.   |
| `datadog_alert`      | `minPriority?: "P1"-"P5"`, `includeTags?: string[]`, `excludePatterns?: string[]`          | Fires on Datadog alerts.                                    |
| `pagerduty_incident` | `minUrgency?: "high" \| "low"`, `includeServices?: string[]`, `excludePatterns?: string[]` | Fires on PagerDuty incidents.                               |
| `slack_mention`      | `channelIds?: string[]`, `excludePatterns?: string[]`                                      | Fires when the bot is mentioned in Slack.                   |

### Runtime State (DB-only, not in agentspec)

- Automation event history (`automation_events`)
- Scheduling/processing state
- Webhook routing metadata

---

## Autonomy Modes

Each resource (or workspace-level default) can declare an autonomy mode that controls how
agent-authored changes are committed:

| Mode           | Behavior                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| `full`         | Agent commits push directly to the default branch. Reconciled immediately. |
| `agent-review` | Agent opens a PR. Another agent or automated check reviews before merge.   |
| `human-review` | Agent opens a PR. Human approval required before merge.                    |

Autonomy mode controls the **commit gate**, not the field surface. Agents have full authoring parity
with humans — any field in any spec is writable. If the commit lands, it reconciles identically
regardless of who authored it.

### Effective Mode Precedence

Effective git autonomy for a repo/run resolves in this order:

1. `Environment.spec.autonomyMode`
3. `workspace.settings.agentspec.defaultAutonomyMode` (default is `human-review`)

Executor enforcement by effective mode:

- `full`: direct push to base branch (no PR). Falls back to PR + auto-merge if branch protection blocks direct push.
- `agent-review`: task branch push + PR with auto-merge enabled
- `human-review`: task branch push + PR, no auto-merge (human must approve and merge)

## Operations

- Reconcile cron: every 5 minutes (`/api/cron/reconcile-agentspecs`) for pending and drift reconciliation.
- Retention cron: daily (`/api/cron/reconcile-agentspec-retention`) deleting reconcile events older than 30 days.
- Failure streaking: `workspaces.agentspecConsecutiveFailures` increments on failure, resets on success.
- Alerting: threshold alert emitted once when failure streak crosses from `2` to `3`.

## Full Cutover Note

Managed configuration authoring is AgentSpec-only for:

- repositories
- environments (structure/policy/required keys; secret values remain DB-only)
- agent definitions/prompts
- skills
- tools
- runtime connectors
- automations

Legacy create/update/delete/toggle UI/actions for those surfaces are retired with
`"Managed by AgentSpec"` errors for mutation attempts.

## Annotations

Annotations are optional key-value pairs on `metadata.annotations` that control lifecycle behavior.

| Annotation                   | Values   | Description                                                                                                                        |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator.dho.dev/prune` | `"true"` | Opt this resource into deletion when removed from the agentspec. Without this, removed resources are kept and marked `orphaned`. |

## What Is Not In the AgentSpec

| Concern                     | Where It Lives                                | Why                                               |
| --------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Secret values               | `environment_secrets` table (encrypted)       | Secrets must never be in a git repository.        |
| Runtime execution state     | Database (runs, activities, events, channels) | High-churn operational data, not authored config. |
| User-scoped auth tokens     | `user_accounts` table                         | User-owned accounts like OpenAI are not declarative workspace config. |
| Runtime connector secrets   | `environment_secrets` table (encrypted)       | Runtime connectors resolve secret values only from environment secrets. |
| Approval records            | Database (audit tables)                       | Operational compliance records.                   |

## Projected Row Fields

Projected rows (DB records created by the reconciler) include shared control-plane fields:

| Field             | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `agentspecKey`       | The `metadata.key` from the spec.                                |
| `agentspecPath`      | File path within the agentspace repo.                            |
| `agentspecChecksum`  | Content hash of the projected resource input.                    |
| `agentspecReconcileStatus` | `ready`, `degraded`, or `orphaned`.                              |
| `agentspecPruneOnDelete`   | Whether the row should be deleted instead of orphaned.           |
