---
name: do-task
description: Fetches a GitHub Issue by number or URL from Eduardobl123/ton-swe-challenge-eduardo, understands the scope, and implements the work in the codebase while keeping the issue and its project board card in sync. Use when the user says "do task X", "implement issue X", "let's work on [URL or issue number]", shares a github.com/.../issues/N link and asks to start, or mentions an issue number and asks for implementation.
compatibility: `gh` (authenticated) and GitHub MCP tools (`mcp__github__*`) each independently cover 100% of this skill — reads, comments, assignment, moving the board card, and opening the PR. Neither is a lesser fallback for the other; only one is required. Board operations need the `project` token scope (`gh auth refresh -s project,read:project`).
allowed-tools: mcp__github__issue_read mcp__github__issue_write mcp__github__search_issues mcp__github__add_issue_comment mcp__github__projects_get mcp__github__projects_list mcp__github__projects_write mcp__github__create_pull_request mcp__github__get_me Read Edit Write Bash Grep Glob ToolSearch
---

# Do Task — Implement a GitHub Issue

Skill for fetching an issue from this repo, understanding the scope, implementing it in the codebase, and keeping the issue and its board card synced with progress.

Repo: `Eduardobl123/ton-swe-challenge-eduardo` — a **user-owned** repo (`owner_type: "user"`, not `org`).
Board: the user's GitHub Project for this repo, with a `Status` field (typically `Backlog`, `Ready`, `In progress`, `In review`, `Done`). The board number is **not hardcoded** — resolve it once (Step 0) and reuse it.

## Step 0 — Check what's available, and resolve the board

Both `gh` and GitHub MCP tools independently cover the full skill, including moving the board card and opening the PR. If the user only has one of the two, everything below still works.

1. **`gh` CLI** — check `gh --version && gh auth status`.
2. **GitHub MCP tools** — run `ToolSearch` with query `mcp__github` to see if they're loaded.

Use whichever is connected for each operation below; if both are, prefer MCP — one structured call instead of a subprocess. If a specific MCP tool doesn't show up (some connections scope down the toolset), use the `gh` form for that one operation, or vice versa.

If neither is available, stop and tell the user: they need an authenticated `gh` CLI (`gh auth login`) or the GitHub MCP server connected.

**Resolve the board number once:**

- **gh CLI**: `gh project list --owner Eduardobl123 --format json`
- **MCP**: `mcp__github__projects_list` with `method: "list_projects"`, `owner: "Eduardobl123"`, `owner_type: "user"`

If `gh` returns `missing required scopes [read:project]`, tell the user to run `gh auth refresh -s project,read:project` and retry. If the scope can't be granted, **continue with the implementation anyway** — the code work does not depend on the board — and state in every status update and in the final summary that the card was not moved and why. Never claim a board move you didn't verify.

Cache the resolved project number, the `Status` field id, and its option ids for the rest of the task; don't re-query per step.

## Step 1 — Extract the issue number

The user may provide:

- Full URL: `https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/6`
- Short form: `#6`, `issue 6`, or just `6`
- Name/search: "a task sobre o webhook de pagamento"

If it's a URL or short form, extract the number. If it's a name/search, look it up first:

- **gh CLI**: `gh issue list --repo Eduardobl123/ton-swe-challenge-eduardo --search "<keywords>" --state open`
- **MCP**: `mcp__github__search_issues` with `owner: "Eduardobl123"`, `repo: "ton-swe-challenge-eduardo"`, `query: "<keywords>"`

## Step 2 — Fetch full issue details

- **gh CLI**: `gh issue view <number> --repo Eduardobl123/ton-swe-challenge-eduardo --json number,title,body,labels,assignees,state,url,comments`
- **MCP**: `mcp__github__issue_read` with `method: "get"`, then `method: "get_comments"` for the discussion history

Also locate the board card:

- **gh CLI**:
  ```bash
  gh project item-list <project-number> --owner Eduardobl123 --format json --limit 50 | \
    jq '.items[] | select(.content.number == <number>)'
  ```
- **MCP**: `mcp__github__projects_list` with `method: "list_project_items"`, `owner: "Eduardobl123"`, `owner_type: "user"`, `project_number: <n>`, `query: "issue:<number>"`, `field_names: ["Status"]`

If the issue isn't on the board yet, add it:

- **gh CLI**: `gh project item-add <n> --owner Eduardobl123 --url https://github.com/Eduardobl123/ton-swe-challenge-eduardo/issues/<number>`
- **MCP**: `mcp__github__projects_write` with `method: "add_project_item"`, `owner: "Eduardobl123"`, `owner_type: "user"`, `project_number: <n>`, `item_type: "issue"`, `issue_number: <number>`, `item_owner: "Eduardobl123"`, `item_repo: "ton-swe-challenge-eduardo"`

Read everything carefully. The body and comments are the spec — extract:

- What needs to be done (expected behavior)
- What's broken or missing (if bug/fix)
- Acceptance criteria (if any)
- Any technical context mentioned

If the issue is too vague to know what "done" looks like, don't guess — suggest running `/grill-me` on it to nail down the scope with the user before writing any code.

## Step 3 — Ask for context and docs

Before touching code, ask the user:

> Você tem alguma spec, doc ou nota de design que ajude nessa task? (ex.: enunciado do challenge, notas de arquitetura, conversas anteriores)

If they share anything, read it. If not, proceed.

## Step 4 — Confirm scope with the user

Present a short summary before touching any code:

```
Issue: #<number> — [título]
Tipo: [bug | feature | melhoria | refactor]
Escopo: [o que será feito, em 2-3 linhas]
Branch: [nome proposto da branch]
```

Always wait for explicit confirmation or adjustment before continuing — never skip this, even if the user seems to be in a hurry.

## Step 5 — Set up the working environment

The GitHub admin calls below (assign, move card, comment) don't produce anything Step 6/7 consumes, and Step 6 doesn't produce anything they need — they're independent. Once the branch exists, the admin calls can run alongside Step 6's investigation. This is an optional speed-up, not a requirement — offer it ("posso disparar as chamadas administrativas do GitHub em paralelo com a investigação do código, quer que eu faça assim?") and only parallelize if the user agrees.

### Git branch

Create a branch following this pattern:

```
feat/{issueNumber}-{title-in-kebab-case}   # nova funcionalidade
fix/{issueNumber}-{title-in-kebab-case}    # correção de bug
chore/{issueNumber}-{title-in-kebab-case}  # manutenção/refactor
docs/{issueNumber}-{title-in-kebab-case}   # documentação
```

Max 60 characters total. Replace accents and spaces with hyphens.

```bash
git checkout -b feat/6-minha-feature
```

Branch off the up-to-date default branch (`main`). If the repo has no commits yet, the first task creates the initial history — say so, and check with the user whether the initial scaffolding should land directly on `main` or on the feature branch.

### Assign the issue

Make sure the issue is assigned to the person who asked for the work — don't skip this even if it seems implicit:

- **gh CLI**: `gh issue edit <number> --repo Eduardobl123/ton-swe-challenge-eduardo --add-assignee @me`
- **MCP**: `mcp__github__issue_write` with `method: "update"`, `issue_number: <number>`, `assignees: ["<login>"]`. MCP has no `@me` shortcut — resolve the current login with `mcp__github__get_me` first.

### Move the issue to "In progress" on the board

- **gh CLI**:
  ```bash
  gh project field-list <n> --owner Eduardobl123 --format json    # Status field id + option ids
  gh project item-edit --project-id <PVT_id> --id <item-id> \
    --field-id <status-field-id> --single-select-option-id <in-progress-option-id>
  ```
  `<PVT_id>` comes from `gh project view <n> --owner Eduardobl123 --format json` (note: `--format json`, not `--json`). `<item-id>` comes from Step 2. On a permissions/scope error: `gh auth refresh -s project,read:project`, then retry.
- **MCP**: `mcp__github__projects_write` with `method: "update_project_item"`, `owner: "Eduardobl123"`, `owner_type: "user"`, `project_number: <n>`, `item_owner: "Eduardobl123"`, `item_repo: "ton-swe-challenge-eduardo"`, `issue_number: <number>`, `updated_field: {"name": "Status", "value": "In progress"}` — resolves the item from the issue number and the option by name server-side.

If the board's `Status` options are named differently, use the actual option names from `field-list` — don't invent one. If none matches, tell the user which options exist and ask.

### Comment on the issue

Any comment posted via `gh`/MCP on behalf of the user must be **prefixed with the model name** — otherwise it reads as if the human wrote it. Bake the prefix into the body itself:

- **gh CLI**: `gh issue comment <number> --repo Eduardobl123/ton-swe-challenge-eduardo --body "Claude Opus 5: 🚀 Iniciando implementação. Branch: feat/{issueNumber}-{slug}"`
- **MCP**: `mcp__github__add_issue_comment` with the same prefixed `body`

## Step 6 — Investigate the codebase

Before writing any code, map out:

1. Files and modules related to the task
2. Patterns used in that area (controllers, services, repositories, tests)
3. Exactly where the change needs to happen
4. Potential side effects on other flows

Read the actual code — don't assume structure without checking. Follow the conventions in the project's `CLAUDE.md` and `README.md` when they exist; when they don't, follow the conventions already visible in the surrounding code.

If the issue clearly touches multiple independent modules or root-cause hypotheses, it's an option to spin up one `Explore` subagent per area in parallel. This is faster but fragments context — each subagent only sees its own slice. Propose it when the split looks genuinely independent and only do it if the user agrees; don't parallelize what's really one file or one flow. Either way, consolidate findings into one picture before deciding where the change goes — don't let parallel subagents write code off their own unreviewed slice.

## Step 7 — Implement

Execute the implementation following project conventions:

- Match the architecture already established in the repo; if the repo is still empty, propose the structure to the user before scaffolding it
- No unnecessary comments
- No features beyond the task scope
- No error handling for impossible scenarios
- Automated tests when there's new business logic

**Detect the verification commands instead of assuming them.** Inspect what the repo actually provides, then run the smallest relevant check:

```bash
cat package.json 2>/dev/null | jq '.scripts'      # Node/TS: typecheck, lint, test, build
cat Makefile 2>/dev/null | grep '^[a-z-]*:'       # Make targets
cat pyproject.toml 2>/dev/null                    # Python: pytest, ruff, mypy
ls go.mod 2>/dev/null && echo "go test ./... / go vet ./..."
ls pom.xml build.gradle* 2>/dev/null              # JVM: mvn test / gradle test
ls docker-compose*.yml 2>/dev/null                # deps needed to run tests
```

Run the checks that exist after each meaningful piece, and fix failures before continuing. If the project has no test/typecheck setup at all, say so — don't silently skip verification, and don't claim a check ran when it didn't.

Changes that involve judgment (not purely mechanical) must be shown to the user for review **before** committing, pushing, or commenting on the issue — don't apply everything and report afterward.

## Step 8 — Update documentation

Documentation is part of the definition of done, not an optional extra — **update it yourself as a normal part of implementing the issue, before the PR opens. Do not ask the user whether they want docs updated; that's not a decision point, it's a step.** The one exception: if you're genuinely unsure whether a stale reference is actually stale, ask about that specific fact — not about whether doc work should happen at all.

Two kinds of doc impact:

1. **Existing docs made stale by this change.** Renaming, removing, or moving anything (a function, an env var, a file, an endpoint, a comment claiming outdated behavior) can leave other files describing the old state. Before committing, grep the repo for the old name/symbol/path across `**/*.md` (root `README.md`, `docs/`, and any `CLAUDE.md`) and fix what you find — prose, tables, code references, and inline comments that assert something no longer true. Don't rewrite historical/decision-log content (ADRs, dated "what we did" notes) that correctly describes a past state — append an update note instead of erasing the record.
2. **New behavior worth documenting.** In a challenge repo the `README.md` is the primary deliverable alongside the code: how to run it, how to test it, the architecture chosen and why, and the trade-offs taken. Any issue that changes setup, commands, endpoints, env vars, or architecture updates the README in the same PR.

Doc content is judgment-laden — show the diff to the user for review same as code, before commit/push. But "should this be done" is already decided: yes.

## Step 9 — Commit and push

Make descriptive commits referencing the issue:

```
feat: descrição do que foi feito

Refs #{issueNumber}
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Use a semantic type: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`. Use `Refs #{issueNumber}`, not `Closes`/`Fixes` — a commit must never close the issue by itself.

Push the branch — `git push -u origin feat/{issueNumber}-{slug}` — before Step 10: opening the PR via MCP needs the branch to already exist on the remote (unlike `gh pr create`, MCP has no git-push step of its own).

## Step 10 — Open the PR, update the issue and board card

### Open the PR

Include `Closes #{issueNumber}` in the body — this is what makes the merge into `main` auto-close the issue, after which the board's built-in workflows (`Item closed`, `Pull request merged`) move the card to `Done`. Don't move the card to `Done` manually; it happens on merge. If those workflows aren't enabled on this board, say so and ask the user whether to move it manually after merge.

Always assign the PR to the current user — every PR opened by this skill must have an assignee.

- **gh CLI**:
  ```bash
  gh pr create --repo Eduardobl123/ton-swe-challenge-eduardo --assignee @me \
    --title "..." --body "$(cat <<'EOF'
  ## Resumo
  ...

  Closes #{issueNumber}
  EOF
  )"
  ```
- **MCP**: `mcp__github__create_pull_request` with `owner: "Eduardobl123"`, `repo: "ton-swe-challenge-eduardo"`, `title`, `head: "feat/{issueNumber}-{slug}"`, `base: "main"`, `body: "...\n\nCloses #{issueNumber}"`. The create-PR call takes no `assignees` — set it in a follow-up `mcp__github__issue_write` with `method: "update"` and `issue_number: <prNumber>` (a PR is an issue for this endpoint), using the login from `mcp__github__get_me`.

If the assignment fails, say so in the final response instead of leaving it silently unassigned.

### Move the issue to "In review" on the board

Same flow as the "In progress" move above (gh: `gh project item-edit` with the in-review option id; MCP: `projects_write` `update_project_item` with `updated_field: {"name": "Status", "value": "In review"}`). If no such option exists, tell the user which options are available and ask which to use instead of guessing.

### Comment with a summary

- **gh CLI**: write the body to a temp file first (avoids shell-quoting issues), then `gh issue comment <number> --repo Eduardobl123/ton-swe-challenge-eduardo --body-file <file>`
- **MCP**: `mcp__github__add_issue_comment`

Prefixed with the model name, same rule as Step 5:

```
Claude Opus 5: ✅ Implementação concluída.

O que foi feito:
- [item 1]
- [item 2]

Arquivos alterados:
- path/to/file.ts
- path/to/other.ts

Branch: feat/{issueNumber}-{slug}
PR: #{prNumber}
Pronto para review — fecha automaticamente no merge para main.
```

## Final response to the user

```
Issue: #{issueNumber} — [título]
Status: In review

O que foi feito:
- [resumo]

Verificações: [comandos executados e resultado, ou "nenhuma suíte configurada no projeto"]
Branch: feat/{issueNumber}-{slug}
Arquivos: [lista]

Próximos passos:
- Revisar e mergear o PR #{prNumber} em main (isso fecha a #{issueNumber} e move o card para Done)
```

---

## Rules

- Never close the issue or move the board card to `Done` directly — that only happens automatically when the PR (with `Closes #N` in the body) merges into `main`.
- Always make sure the issue is assigned (Step 5) before or when moving it to `In progress`.
- `gh` and MCP each independently cover the whole skill — don't assume the user needs both, and don't degrade behavior for whichever is missing.
- Board sync is best-effort: if the token lacks the `project` scope, the implementation still proceeds and the final summary states plainly that the card wasn't moved.
- Any comment posted to GitHub on behalf of the user must be prefixed with the model name.
- Judgment calls — design decisions, non-mechanical changes — must be shown to the user for review before committing, pushing, or commenting. Purely mechanical steps (branch creation, status moves, progress comments) don't need this.
- If the issue has a task list (`- [ ]` items) or sub-issues, treat them as a checklist — report progress on each.
- If the issue mentions dependencies on other issues, check they're resolved before implementing.
- Never claim a command, test, or CI run passed unless it actually ran.
- Separate facts confirmed in code from assumptions when communicating with the user.
- Don't create intermediate planning/scratch files in the repo unless the user asks.
