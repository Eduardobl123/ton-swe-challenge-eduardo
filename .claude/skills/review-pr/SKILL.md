---
name: review-pr
description: Reviews pull requests, branches, diffs, and code changes in ton-swe-challenge-eduardo as an independent senior engineer who did not implement the feature. Use when the user asks to review a PR, review code, validate a feature before merge, find regressions, assess merge safety, or perform an external technical analysis. Reconstructs the project context from the issue/spec, repository rules, architecture, callers, data flows, tests, and Git history instead of trusting the implementation rationale. Produces a rigorous PT-BR review with evidence, severity, confidence, blast radius, and a merge recommendation.
argument-hint: [pr_number_or_url_or_branch]
compatibility: Works with a local checkout using git. For GitHub PR context, use an authenticated `gh` CLI or available GitHub MCP tools. Repository: Eduardobl123/ton-swe-challenge-eduardo. Default behavior is read-only analysis; publishing a GitHub review requires explicit user approval after preview.
allowed-tools: mcp__github__pull_request_read mcp__github__issue_read mcp__github__search_issues mcp__github__get_me mcp__github__pull_request_review_write mcp__github__add_comment_to_pending_review mcp__github__add_reply_to_pull_request_comment Read Grep Glob Bash ToolSearch
---

# Independent Senior Code Review

## Goal

Review a change in this repository as an **independent senior engineer**, not as the engineer who implemented it.

The objective is to determine, from evidence, whether the change:

- solves the stated problem
- preserves existing behavior that should remain valid
- follows project architecture and contracts
- is safe for data, concurrency, integrations, and security
- has meaningful behavioral tests
- is operationally observable and reliable
- is ready to merge

The goal is **not** to justify the implementation, maximize approval rate, or produce a large number of comments.

All user-facing review content must be written in **PT-BR**. Code identifiers, paths, commands, GitHub references, and proper nouns remain as-is.

## Context: this is a take-home challenge repo

This repository is a SWE challenge deliverable, which changes what "material" means without lowering the bar for correctness:

- **Correctness, security, and data-integrity findings carry full weight.** A race condition or an authorization hole is exactly what a reviewer of a challenge is looking for.
- **Clarity of the README and of the architectural reasoning is part of the deliverable**, not a nice-to-have — a change that makes the project harder to run or to understand is a real finding.
- **Don't demand production scaffolding the brief never asked for** (multi-region, feature-flag infrastructure, elaborate observability stacks) unless the brief itself asked for it. Note it as a non-blocking observation, not a defect.
- If the challenge brief is available, treat it as the top-level specification (see Step 2).

## Reviewer posture — external and independent

Treat the PR as if it was written by another engineer you have never spoken to.

If this skill runs in the same conversation/session that implemented the feature:

- do not reuse the implementation reasoning as evidence
- do not defend decisions because "we chose them earlier"
- do not treat previous explanations from the implementer as facts
- rebuild the mental model from the repository, issue/spec, docs, diff, callers, tests, and contracts
- when available, prefer a fresh read-only review subagent for an independent first pass, then consolidate the result yourself

The implementation is the object being evaluated. It is not an authority about its own correctness.

### Independence rules

- PR description and author comments explain intent; they do not prove correctness.
- Passing tests are evidence; they do not prove the feature is correct.
- If implementation and requirement disagree, report the mismatch. Do not reinterpret the requirement to fit the code.
- If a test encodes behavior that contradicts the requirement, the test does not make that behavior correct.
- If safety depends on an assumption, find where that assumption is enforced.
- If the assumption is not enforced, keep it visible as a risk or defect.
- Never dismiss a concern with "probably", "likely never happens", or "the framework should handle it" without verifying it.
- Do not give the implementation the benefit of the doubt when critical evidence is missing.

Independent does **not** mean hostile:

- do not invent defects
- do not report style preferences as engineering problems
- do not demand abstractions only because another design exists
- do not reopen unrelated pre-existing issues unless the PR worsens/exposes them
- do not keep a finding after the code clearly disproves it
- do not manufacture comments to make the review look thorough

The standard is **skeptical, fair, and evidence-driven**.

## Evidence model

Use the right source for the right question.

### Intended behavior

Prefer:

1. the challenge brief / statement, when available
2. acceptance criteria in the linked issue
3. project documentation (`README.md`, `docs/`, any ADRs)
4. root and scoped `CLAUDE.md`
5. public contracts, schemas, API behavior, and established invariants
6. PR description and author comments as supporting context only

### Actual behavior

Determine from:

1. production code
2. control/data flow across callers and callees
3. persistence, queues, cache, jobs, integrations, and configuration
4. tests as evidence of exercised scenarios
5. Git history when needed to understand a regression or established invariant

Never use the PR description to override what the code actually does.

## Core rules

- Read the actual project code before judging the change.
- Review behavioral impact, not only changed lines.
- Do not modify code unless the user explicitly asks for fixes after the review.
- Do not commit, push, approve, request changes, or publish comments without explicit authorization.
- Do not publish while findings are still being discovered or validated.
- Separate **confirmed fact**, **strong inference**, **hypothesis**, and **unknown**.
- Do not claim a test/command/benchmark ran unless it actually ran.
- Do not expose secrets or sensitive values found during review.
- Every defect must be introduced, worsened, or materially exposed by this change.
- One root cause = one finding. Deduplicate symptoms.
- A passing CI run does not override a verified defect.
- A clean code review does not override failing required checks.
- Missing critical context means uncertainty, not automatic approval.

## Step 0 — Resolve the review target

Supported modes:

- **PR mode** — PR number, URL, or current branch with an open PR
- **branch mode** — local branch compared with its merge base
- **file/snippet mode** — limited review when repository context is unavailable

For GitHub PRs:

1. Check `gh --version && gh auth status`.
2. If `gh` is unavailable, run `ToolSearch` with query `mcp__github` and use the GitHub MCP read tools if present.
3. If GitHub metadata is unavailable but the branch exists locally, continue in branch mode and state what could not be inspected.

Default repo: `Eduardobl123/ton-swe-challenge-eduardo`.

## Step 1 — Collect PR / diff context

In PR mode, collect:

- PR number, title, state, base, head, URL
- PR body
- changed files
- commits
- relevant review discussion
- required checks / CI state
- linked issue(s)

Useful `gh` commands:

```bash
gh pr view <number> --repo Eduardobl123/ton-swe-challenge-eduardo \
  --json number,title,body,state,author,baseRefName,headRefName,files,commits,reviews,comments,statusCheckRollup,url

gh pr diff <number> --repo Eduardobl123/ton-swe-challenge-eduardo
```

In branch mode:

1. identify the intended base, normally `main`
2. resolve the merge base
3. review the complete branch diff from merge base to HEAD
4. state the exact comparison used

```bash
git merge-base origin/main HEAD
git diff <merge-base>...HEAD
```

Do not accidentally review only unstaged changes when the request is a PR/branch review.

## Step 2 — Read the specification first

If the PR links an issue, read its full body and relevant comments. Also read the challenge brief if it's in the repo (`README.md`, `CHALLENGE.md`, `docs/`) or if the user can provide it — that's the top-level requirement document, and an issue that contradicts it is itself a finding.

Extract:

- problem being solved
- expected behavior
- acceptance criteria
- explicit non-goals
- constraints
- rollout/migration expectations
- unresolved questions

The issue defines intent. It does not make the proposed technical solution correct.

If requirements are vague, review everything that can be established and list the ambiguity as a limitation instead of inventing criteria.

## Step 3 — Load project context

Before judging the diff:

1. read root `CLAUDE.md`, if present
2. read scoped/nested `CLAUDE.md` for changed files
3. read `README.md` and anything under `docs/` (including ADRs, if the project keeps them)
4. inspect neighboring code to identify established patterns

When relevant, map:

- controllers/routes/consumers/jobs
- application/domain services
- ports/adapters
- repositories and persistence
- queues/workers
- cache/locks
- external integrations
- entities/migrations/schema structures
- API boundaries
- tests and mocks

Do not flag a project-pattern violation until the applicable convention is confirmed. In a young repo, "the convention" may be a single prior file — say so instead of asserting a rule that doesn't exist.

## Step 4 — Reconstruct the real flow outside-in

Do this before deciding whether the implementation is good.

Map:

1. entry point
2. validation/authentication/authorization
3. route/controller/consumer/job
4. main service(s)
5. repository/database reads and writes
6. queue/cache interactions
7. external integrations
8. emitted side effects/events
9. downstream readers/consumers
10. user-visible or operational result

For changed public methods, contracts, schemas, events, entity fields, or shared behavior:

- find callers
- find consumers
- find alternate paths
- find relevant tests
- identify old behavior still relied upon elsewhere

### Blast radius

Explicitly consider:

- direct changed path
- upstream callers
- downstream consumers
- shared state
- public contracts
- persisted data/schema compatibility
- async/retry behavior
- multi-instance behavior
- observability
- rollout/rollback compatibility

Do not assume a change is isolated because only one file changed.

## Step 5 — Review the diff in context

Read every meaningful changed hunk after the surrounding flow is understood.

For each behavioral change ask:

- What invariant does this rely on?
- Where is that invariant enforced?
- What changed from the previous behavior?
- Which callers now observe different behavior?
- Can a side effect happen earlier, later, twice, or not at all?
- Can success be reported after partial failure?
- Can state be partially persisted?
- Can retry duplicate an action?
- Can concurrent execution violate an assumption?
- Does this widen a trust boundary?
- Does it still satisfy the issue/spec?

Read outside the diff whenever needed to prove the answer.

## Step 6 — Run senior review passes

Run the relevant passes below. For large independent surfaces, read-only subagents may produce candidate findings in parallel, but the main reviewer must consolidate the whole system before deciding anything.

### A. Requirements and contracts

Check:

- each acceptance criterion has an implementation path
- edge/error cases still satisfy the contract
- public API/event/schema compatibility
- hidden behavioral changes
- accidental scope expansion

Trace important requirements as:

`requirement → implementation → test/verification`

### B. Correctness and regression

Check:

- incorrect conditions/branches
- state transition errors
- null/empty/boundary cases
- stale assumptions
- ordering problems
- partial updates
- changed defaults
- callers not updated
- return/error semantics changed
- previously valid flows now broken

Compare against pre-PR behavior when regression risk exists.

### C. Architecture and responsibility

Check:

- layer boundaries
- dependency direction
- duplicated domain logic
- business rules in the wrong layer
- bypassed ports/adapters
- second sources of truth
- unclear ownership
- coupling that creates concrete regression/testability risk

Do not request refactors only for aesthetics.

### D. Data, concurrency, async work, and idempotency

When the change touches database writes, queues, jobs, cache, webhooks, scheduling, or multiple instances, check:

- transaction boundaries
- read-modify-write races
- duplicate deliveries
- retry behavior
- idempotency
- lock scope/TTL
- TOCTOU
- out-of-order events
- partial success
- stale cache/state
- multi-instance behavior
- rollback
- migration compatibility

Do not assume "this only runs once" unless the system enforces it.

### E. Security and trust boundaries

Check:

- authentication
- authorization
- tenant/user ownership
- permission escalation
- untrusted input
- injection/deserialization
- sensitive data exposure
- token/secret handling
- webhook/callback trust
- destructive operations
- sensitive logging

### F. Error handling and reliability

Check:

- swallowed exceptions
- catch-all handlers
- false-success fallbacks
- retry loops
- timeout/cancellation
- cleanup/resource leaks
- external integration failures
- inconsistent partial state
- misleading/insufficient logs

A fallback is valid only when degraded success is part of the real contract.

### G. Tests as evidence

Read the tests, not only their names.

Check:

- new business behavior is covered
- bug fixes have meaningful regression tests when practical
- error/negative paths are covered
- authorization cases are covered when relevant
- boundaries are represented
- mocks do not remove the behavior under test
- assertions verify outcomes/side effects
- tests were not weakened/deleted to make the PR pass

Passing tests mean those scenarios passed. Nothing more.

### H. Performance and resources

When relevant, check:

- N+1 calls/queries
- accidental quadratic work
- repeated expensive work
- unbounded memory/list growth
- resource leaks
- blocking hot paths
- cache behavior
- query/index implications
- unnecessary external calls

Do not report micro-optimizations without plausible production impact.

### I. Maintainability, docs, and observability

Only report material concerns:

- duplicated business rules
- misleading names/comments
- hidden important invariants
- unnecessary complexity that obscures behavior
- weak tracing on critical async flows
- magical strings/constants that create real maintenance risk
- `README.md` or setup instructions left inconsistent with the code the PR ships (in a challenge repo this is material, not cosmetic — a reviewer who can't run the project can't evaluate it)

P3 taste/style observations must not dominate the review.

## Step 7 — External reviewer challenge

After understanding the implementation, challenge it explicitly:

1. What must be true for this implementation to be safe?
2. Which assumptions are actually enforced?
3. What happens on duplicate execution?
4. What happens after partial failure?
5. What happens with concurrency/multiple instances?
6. What happens with old persisted data?
7. What happens during mixed-version rollout when relevant?
8. What happens when an integration times out or returns an unexpected valid response?
9. Which existing caller may still rely on the old contract?
10. Could the tests pass while production behavior is wrong?
11. Is an "impossible" state impossible by code, or only by assumption?
12. What is the strongest evidence-based argument against merging as-is?

Answer from code and contracts, not from the author's rationale.

## Step 8 — Validate findings without defending the PR

Every observation is a **candidate** until validated.

For each candidate:

1. identify the exact changed behavior
2. identify file/line
3. trace the triggering path
4. inspect guards, callers, contracts, tests, and configuration
5. confirm it was introduced/worsened by this PR
6. look for concrete evidence that disproves the candidate
7. assign severity and confidence

The purpose of this step is to avoid a false accusation, **not** to find an excuse for the implementation.

Do not dismiss findings with:

- "the author probably intended..."
- "this likely never happens..."
- "tests pass..."
- "the framework probably handles it..."
- "the pattern looks familiar..."

Verify those claims or keep the uncertainty visible.

If critical context is unavailable, use `INCONCLUSIVE` where appropriate. Lack of evidence is not evidence of safety.

## Severity and confidence

Keep impact and certainty separate.

### P0 — Critical

Catastrophic/broadly exploitable security risk, unrecoverable data corruption/loss, or fundamentally unsafe deployment.

Blocks merge.

### P1 — High

Concrete defect likely to break an important workflow, violate security/authorization, corrupt significant state, break compatibility, or create serious reliability problems.

Blocks merge.

### P2 — Medium

Real limited-scope defect, meaningful operational risk, important missing behavioral protection, or maintainability problem likely to create future defects.

Should be addressed; does not automatically block every PR.

### P3 — Low

Minor readability, simplification, documentation, or polish improvement.

Never blocks merge alone.

### Confidence

- `0–49` — speculative: discard as defect
- `50–79` — plausible but unproven: keep only as question/unknown when materially relevant
- `80–89` — verified and actionable
- `90–99` — strongly verified with clear path/evidence
- `100` — directly demonstrated or logically unavoidable

Default threshold for a defect: **80**.

Prefer **90+** for P0/P1. If necessary evidence is unavailable, state the limitation instead of faking certainty.

## False-positive filter

Do not report as defects:

- unrelated pre-existing issues
- pure style preferences
- lint/format nits already handled mechanically
- alternate designs without a demonstrated problem
- hypothetical failures without a credible trigger
- concerns contradicted by a verified project/framework guarantee
- duplicate symptoms of the same root cause
- generic "add tests" requests without a concrete behavior/risk
- behavior explicitly required by the accepted specification
- missing production infrastructure the challenge brief never asked for

Filtering false positives is not permission to defend suspicious code with assumptions.

## Step 9 — Run verification

**Inspect package scripts/config before assuming commands** — this repo's stack may change as the challenge grows, so detect, don't memorize:

```bash
cat package.json 2>/dev/null | jq '.scripts'      # Node/TS
cat Makefile 2>/dev/null | grep '^[a-z-]*:'       # Make targets
cat pyproject.toml 2>/dev/null                    # Python
ls go.mod 2>/dev/null                             # Go
ls pom.xml build.gradle* 2>/dev/null              # JVM
ls .github/workflows/*.yml 2>/dev/null            # what CI actually runs
```

The CI workflow files are the most reliable statement of what "the checks" are — prefer them over guessing.

Run the smallest relevant checks first, then broader checks when justified by blast radius.

Report separately:

- commands executed
- passed checks
- failed checks
- checks not executed
- failures that appear unrelated/pre-existing
- GitHub CI state

Never write "CI passou" when only local tests passed.

## Step 10 — Decide merge readiness

### REQUEST_CHANGES

Use when:

- validated P0/P1 exists
- an acceptance criterion is concretely unmet
- security/data/migration behavior is unsafe as implemented

### COMMENT

Use when:

- no P0/P1 blocker exists
- meaningful P2 findings remain
- important non-blocking unknowns/questions remain

### APPROVE

Use only when:

- no validated P0/P1/P2 remains
- intended behavior is sufficiently clear
- flow and blast radius were inspected
- relevant verification is credible
- required CI is not known to be failing
- no critical unknown prevents responsible approval

Do not approve merely because no bug was found inside the diff.

### INCONCLUSIVE

Use when missing context prevents a responsible merge recommendation.

## Required review output

Write the review in PT-BR:

```markdown
# Revisão técnica — PR #<n> / <branch>

**Decisão:** APPROVE | COMMENT | REQUEST_CHANGES | INCONCLUSIVE
**Base → Head:** <base> → <head>
**CI:** <passando | falhando | pendente | não verificado>
**Achados:** <P0/P1/P2/P3>

## Resumo executivo

<o que mudou, se atende ao objetivo e principal razão da decisão>

## Contexto e fluxo analisado

- Issue/especificação: ...
- Entrada principal: ...
- Serviços principais: ...
- Persistência/estado: ...
- Assíncrono/integrações: ...
- Blast radius: ...

## Achados

### 1. [P1][95%] <título objetivo>

`src/.../file.ts:42-58` · <categoria>

**Fato observado:** ...
**Por que é problema:** ...
**Cenário que dispara:** ...
**Impacto:** ...
**Direção de correção:** ...
**Teste/validação esperada:** ...

## Testes e verificações

- `command` — PASS/FAIL
- CI — ...
- Cenários importantes: ...
- Lacunas relevantes: ...

## Pontos não bloqueantes

- somente observações realmente úteis

## Arquivos e referências analisados

- `path/to/file.ts:line` — papel no fluxo
- `docs/...` — regra/contrato usado

## Limitações / pontos não confirmados

- somente quando algo relevante não pôde ser verificado
```

If there are no findings, do not invent P3 comments. Explain what was checked and why the PR appears safe.

## Finding contract

Every P0/P1/P2 must include:

- location
- category
- fact observed
- concrete impact
- trigger/path
- severity
- confidence
- smallest safe fix direction
- expected regression test/verification when applicable

Preferred style:

> `payments.service.ts:118-129` persiste a transação antes da chamada ao provedor externo e captura a falha do provedor sem reverter nem marcar o registro local como degradado. O estado local e o externo podem divergir enquanto o fluxo ainda reporta sucesso.

Avoid vague comments:

> Esse tratamento de erro talvez cause problemas.

## Categories

Use one primary category:

- `correção`
- `regressão`
- `segurança`
- `autorização`
- `concorrência`
- `idempotência`
- `dados/migração`
- `confiabilidade`
- `integração`
- `contrato/API`
- `arquitetura`
- `testes`
- `performance`
- `observabilidade`
- `manutenibilidade`
- `documentação`
- `regra do projeto`

## GitHub publication

Default: **local report only**.

If the user asks to publish:

1. finish discovery and validation first
2. show the exact review body and inline comments
3. show intended event: `APPROVE`, `COMMENT`, or `REQUEST_CHANGES`
4. wait for explicit approval
5. publish only approved content
6. verify it landed on the intended PR/head revision
7. report what was published

GitHub content posted on behalf of the user must be **prefixed with the model name** (e.g. `Claude Opus 5: ...`), same rule as the other skills in this repo.

Note: on a solo repo the author and the reviewer are the same GitHub account, and GitHub rejects `APPROVE`/`REQUEST_CHANGES` on your own PR. If that happens, publish as `COMMENT` and say in the body which decision the review actually reached — don't silently downgrade the verdict.

Do not scatter comments during discovery. Batch the final review.

Do not publish P3 inline comments by default.

## Relationship with `do-task`

`do-task` implements work. `review-pr` judges the result.

When the PR was produced by `do-task`:

- independently re-read the issue
- independently reconstruct the flow
- independently inspect tests and contracts
- do not assume the implementation skill followed the issue correctly
- do not reuse its design justification as evidence
- do not fix findings automatically

If the user later asks to address findings, that is a separate implementation step.

## Final rules

- Review like a senior responsible for production, not like the feature author.
- Understand the project before judging the patch.
- Verify assumptions instead of repeating them.
- Search for regressions outside changed lines.
- Treat tests as evidence, not authority.
- Do not protect the implementation from criticism.
- Do not attack the implementation without evidence.
- Prefer one strong finding over five speculative comments.
- Missing critical evidence prevents approval; it does not prove safety.
- Nothing is posted or modified without user authorization.
- A strong review may contain zero findings. The requirement is independent judgment backed by evidence.
