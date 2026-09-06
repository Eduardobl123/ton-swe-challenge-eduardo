---
name: create-task
description: Analyzes technical problems or feature requests in the ton-swe-challenge-eduardo project, investigates root cause in the code, and creates or updates structured GitHub Issues in Eduardobl123/ton-swe-challenge-eduardo, tracked on the project board. Use when the user reports a bug, unexpected behavior, missing feature, integration failure, or asks to open a card, create a task, document an issue, or investigate root cause.
compatibility: Requires either an authenticated `gh` CLI or GitHub MCP tools, with access to Eduardobl123/ton-swe-challenge-eduardo. Board operations additionally need the `project` token scope (`gh auth refresh -s project,read:project`).
allowed-tools: mcp__github__issue_write mcp__github__issue_read mcp__github__search_issues mcp__github__list_issues mcp__github__list_issue_fields mcp__github__list_issue_types mcp__github__get_label mcp__github__add_issue_comment mcp__github__projects_list mcp__github__projects_write Read Write Bash ToolSearch
---

# Create Task — GitHub Technical Issue

## Goal

Investigate a technical problem or feature request in this project, identify the root cause (or the precise gap), and document the analysis in a structured GitHub Issue on the project board.

## Step 0 — Pick the GitHub integration

This skill can talk to GitHub two ways. Decide once, at the start of the task:

1. **`gh` CLI first** — check for the CLI: `gh --version && gh auth status`. If that succeeds, use the **gh CLI path** for everything below.
2. **MCP fallback** — if `gh` isn't available or isn't authenticated, run `ToolSearch` with query `mcp__github` to see whether the GitHub MCP tools are loaded. If so, use the **MCP path** for everything below.
3. If neither is available, stop and tell the user: they need either an authenticated `gh` CLI (`gh auth login`) or the GitHub MCP server connected before this skill can create issues.

Do not mix the two paths mid-task — pick one after the check and stick with it, so labels/fields/comments all land through the same interface.

## Default destination

Always create or update technical issues in:

**GitHub repo `Eduardobl123/ton-swe-challenge-eduardo`** (a **user-owned** repo — `owner_type: "user"`, not `org`), tracked on the user's project board — see "Project board membership" below.

Destination rules:

- Use this destination for any technical task in this repository.
- Before creating a new issue, search for an existing one covering the same problem:
  - **gh CLI**: `gh issue list --repo Eduardobl123/ton-swe-challenge-eduardo --search "<keywords>"`
  - **MCP**: `mcp__github__search_issues` or `mcp__github__list_issues`

  If a matching open issue exists, update it instead of creating a duplicate:
  - **gh CLI**: `gh issue edit <number> --repo Eduardobl123/ton-swe-challenge-eduardo ...`, or `gh issue comment <number> --repo Eduardobl123/ton-swe-challenge-eduardo --body-file <file>` for incremental findings.
  - **MCP**: `mcp__github__issue_write` with `method: update`, or `mcp__github__add_issue_comment` for incremental findings.

- Do not create issues in any other repository without an explicit user request.

### Project board membership

The board number is **not hardcoded** in this skill — resolve it once per session and reuse it.

- **gh CLI**:
  ```bash
  gh project list --owner Eduardobl123 --format json     # find the board number + title
  gh project item-add <project-number> --owner Eduardobl123 --url <issue-url>
  ```
- **MCP**: `mcp__github__projects_list` with `method: "list_projects"`, `owner: "Eduardobl123"`, `owner_type: "user"` to find the number; then `mcp__github__projects_write` with `method: "add_project_item"`, `owner: "Eduardobl123"`, `owner_type: "user"`, `project_number: <n>`, `item_type: "issue"`, `issue_number: <number>`, `item_owner: "Eduardobl123"`, `item_repo: "ton-swe-challenge-eduardo"`.

If `gh project list` fails with `missing required scopes [read:project]`, the token lacks the project scope — tell the user to run:

```bash
gh auth refresh -s project,read:project
```

and retry. If the user declines or the scope can't be granted, still create the issue, then say plainly in the final summary that the card was **not** added to the board and why. Never report board placement you didn't verify.

If the board has GitHub's native **"auto-add to project"** workflow enabled for this repo, the item-add call is redundant but harmless (it's idempotent).

## Step 1 — Ask for context and docs

Before investigating, ask the user:

> Você tem alguma spec, doc ou contexto anterior que ajude na investigação? (ex.: enunciado do challenge, notas de arquitetura, logs, conversas anteriores)

If they share anything, read it before proceeding. The challenge statement (README, PDF, or the original brief) is the highest-value input here — it's the closest thing this repo has to a requirements document.

## Core rules

- Do not modify code without explicit authorization.
- Do not create implementation before completing the analysis.
- Investigate first, document after.
- Analyze the actual project code before asserting root cause.
- Clearly separate facts found in code from hypotheses.
- Always explain root cause and technical impact.
- Always list files analyzed.
- Use clear, objective, and actionable technical language.
- When creating or updating the issue, include enough context for another developer (or AI agent) to apply the fix later.
- **Write the issue title and body in Portuguese (PT-BR).** This skill file is in English — that's instructions for you, not output. The text that lands in GitHub goes in Portuguese. Code snippets, file paths, and identifiers quoted from the codebase stay as-is.
- Any comment posted to GitHub on behalf of the user must be **prefixed with the model name** (e.g. `Claude Opus 5: ...`), so it doesn't read as if the human wrote it.

## Required process

1. Understand the problem or request reported by the user.
2. Locate related files in the project. If the repository is still empty or the area doesn't exist yet, say so explicitly — the issue then documents a **gap**, not a defect, and the "Causa raiz" section states that the code path does not exist.
3. Map the current code flow.

   If the problem clearly spans multiple independent modules or root-cause hypotheses, it's an option to spin up one `Explore` subagent per area/hypothesis in parallel instead of reading everything sequentially in this thread — faster, but each subagent only sees its own slice, so nothing catches a cross-module dependency unless you look at the findings together afterward. Propose it to the user when the split looks genuinely independent, and only do it if they agree; for a problem confined to one file or one flow, sequential reading is simpler and just as correct. Either way, consolidate findings into one picture before moving to root cause.

4. Identify where the incorrect behavior occurs.
5. Determine root cause based on the code.
6. Propose a safe technical solution.
7. Search existing issues for a duplicate before creating a new one.
8. Create or update the GitHub Issue and add it to the board (see "Creating the issue", "Labels and fields", and "Project board membership").
9. Ask the user if any documentation needs to be created or updated as a result.
10. Return a summary to the user with: issue link, root cause, files analyzed, recommended solution, and next steps.

## Creating the issue

`title` and `body` go in Portuguese (PT-BR) — see "Core rules".

- **gh CLI**: write the body to a temp file first (avoids shell-quoting issues with a long Markdown body), then:
  ```bash
  gh issue create --repo Eduardobl123/ton-swe-challenge-eduardo \
    --title "<title>" --body-file <file> --label "<bug|enhancement>"
  ```
  `gh issue create` prints the issue URL on success — capture it for the board-add step and the final summary.
- **MCP**: `mcp__github__issue_write` with `method: create`, passing `owner: "Eduardobl123"`, `repo: "ton-swe-challenge-eduardo"`, `title`, `body`, and `labels`.

## Labels and fields

**Labels** — apply the label matching the issue type. A fresh GitHub repo ships with the default set (`bug`, `enhancement`, `documentation`, `question`, …):

- `bug` — something isn't working
- `enhancement` — new feature or improvement request
- `documentation` — docs-only work

Verify a label exists before applying it if unsure; if a needed label doesn't exist, either create it (with the user's OK) or tell the user instead of inventing one silently.

- **gh CLI**: `gh label list --repo Eduardobl123/ton-swe-challenge-eduardo --search "<name>"`
- **MCP**: `mcp__github__get_label`

**Custom fields — two separate systems, do not conflate them.** GitHub has two independent custom-field mechanisms:

1. **Issue-level custom fields** (`Priority`, `Effort`, when configured) — live on the _issue itself_ (`Issue.issueFieldValues`), scoped to the repo, and are **not** part of Projects v2 (different ID namespace: `IFSS_`/`IFSSO_` vs `PVT*`). `gh` has no subcommand for this system; it's raw GraphQL:

   ```graphql
   # discover fields + option ids (do this once, cache the ids)
   query {
     repository(owner: "Eduardobl123", name: "ton-swe-challenge-eduardo") {
       issueFields(first: 20) {
         nodes {
           ... on IssueFieldSingleSelect {
             id
             name
             options {
               id
               name
             }
           }
         }
       }
     }
   }
   ```

   ```graphql
   # set a value — issueId is the plain Issue node id (I_...), not a project item id (PVTI_...)
   mutation ($issueId: ID!, $fieldId: ID!, $optionId: ID!) {
     setIssueFieldValue(
       input: {
         issueId: $issueId
         issueFields: [{ fieldId: $fieldId, singleSelectOptionId: $optionId }]
       }
     ) {
       clientMutationId
     }
   }
   ```

   Read back with `repository(...).issue(number: N).issueFieldValues(...)` to verify. A Projects v2 query (`gh project item-list`/`field-list`) will **never** show these values — it's querying a different system, so an empty result there says nothing.
   - **MCP**: `mcp__github__issue_write`'s `issue_fields` param (with `mcp__github__list_issue_fields` to discover names/options) targets this same API — prefer it when connected.
   - These fields are optional and may simply not be configured on this repo. If `issueFields` comes back empty, skip them — don't try to create them.

2. **Project v2 fields** (`Status`, `Size`, `Start date`, `Target date`) — live on the board (`PVT*` ids):
   ```bash
   gh project view <n> --owner Eduardobl123 --format json          # Project v2 node id (PVT_...)
   gh project field-list <n> --owner Eduardobl123 --format json    # field id + option ids
   gh project item-list <n> --owner Eduardobl123 --format json     # item id for this issue
   gh project item-edit --project-id <PVT_id> --id <item-id> \
     --field-id <field-id> --single-select-option-id <option-id>
   ```
   `Status` is normally set by the board's own workflow (new issues land in the default column) — this skill does not set it directly.

Only set dates if the user gives an actual timeline; do not guess dates. If field values aren't essential, it's fine to skip them and just get the issue created, labeled, and on the board — mention which fields were left unset.

## Required issue body structure

Write the issue body in Markdown, in Portuguese (PT-BR), with these sections. The headers are given in Portuguese because they're copied verbatim into the issue; the guidance under each is for you, in English.

### Contexto do problema

Describe the problem objectively and explain the impact on the product, user, or operation. For a challenge repo, also state which requirement of the brief it affects, when applicable.

### Fluxo atual identificado

Explain the actual path found in the code, including when applicable:

- request entry point
- controller, route, or handler
- main service
- workers, queues, cache, or jobs
- external integrations
- exact point where the incorrect behavior occurs

If the flow does not exist yet, write "não implementado" and describe the intended flow instead — clearly marked as intent, not fact.

### Causa raiz

Technically explain the root cause based on the files analyzed.

Make clear if the conclusion is:

- fact confirmed in code
- likely hypothesis
- point that still needs validation

### Por que acontece

Explain the reason for the current system behavior in plain language.

### Solução proposta

Describe an implementable, safe, and architecture-compatible solution.

When useful, include:

- flow change
- services involved
- use of queue, cache, debounce, lock, or idempotency
- required logging
- concurrency concerns
- rollback strategy

### Critérios de aceite

List objective criteria to validate the fix. Examples:

- Expected behavior occurs in the normal scenario.
- Error cases are handled.
- No regression in the current flow.
- Logs allow tracing the corrected flow.
- Automated test covers the corrected behavior.

### Riscos e pontos de atenção

List technical risks, side effects, and points of attention before implementation.

### Arquivos analisados

List the actual files analyzed and the role of each. If nothing existed to analyze, say that explicitly rather than listing plausible-sounding paths.

### Recomendação final

State the best approach for the next step, making clear whether it's safe to implement or if something still needs to be validated.

## Ask about documentation

After creating or updating the issue, ask the user:

> Essa análise afeta algo que precisa de documentação? (ex.: README, decisões de arquitetura, instruções de execução do projeto)

## Final response to the user

```
Issue: <url>
Labels: <labels applied>
Board: <adicionada ao board #<n> | não adicionada — motivo>
Fields: <Priority/Effort set, if any>

Causa raiz:
<short summary>

Arquivos analisados:
- <file 1>
- <file 2>

Solução recomendada:
<short summary>

Próximos passos:
<what should be done next>
```
