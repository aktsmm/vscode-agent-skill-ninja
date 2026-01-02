# Prompt: Review Agent Definition

Prompt for reviewing agent definitions (.agent.md) with cross-reference validation against project assets.

## Step 0: Context Collection (Do First)

Read the following files before reviewing:

- [ ] `README.md` — Project overview and purpose
- [ ] `AGENTS.md` — Agent registry and role definitions
- [ ] `.github/agents/*.agent.md` — Agent definitions
- [ ] `.github/instructions/**/*.md` — Shared rules and constraints
- [ ] `.github/copilot-instructions.md` — Global guardrails

## Design Principles Checklist

### Tier 1: Core Principles (Required)

- [ ] **SRP**: Is it 1 agent = 1 responsibility?
- [ ] **SSOT**: Is information centrally managed?
- [ ] **Fail Fast**: Can errors be detected early?

### Tier 2: Quality Principles (Recommended)

- [ ] **I/O Contract**: Are inputs/outputs clearly defined?
- [ ] **Done Criteria**: Are completion conditions verifiable?
- [ ] **Idempotency**: Is the design retry-safe?
- [ ] **Error Handling**: Is error handling documented?

### Structure Check

- [ ] Is Role clear in one sentence?
- [ ] Are Goals specific?
- [ ] Are Permissions minimal?
- [ ] Is Workflow broken into steps?

## Cross-Reference Validation

- [ ] Does `AGENTS.md` role description match `.agent.md` Role section?
- [ ] Are prohibited operations (from instructions) not granted in Permissions?
- [ ] No duplicate information between `AGENTS.md` and `.agent.md`? (SSOT)
- [ ] Does workflow align with project context described in `README.md`?
- [ ] Does workflow respect dependencies defined in other agents?

## Orphan Detection

Check that assets are properly referenced:

- [ ] `.github/instructions/**/*.instructions.md` → Referenced from `copilot-instructions.md`?
- [ ] `.github/instructions/**/*.instructions.md` → Listed in `AGENTS.md` Instructions table?
- [ ] `.github/instructions/README.md` → Tree structure matches actual files?
- [ ] `.github/prompts/*.prompt.md` → Listed in `README.md` prompts table?
- [ ] `.github/agents/*.agent.md` → Listed in `AGENTS.md` agents table?

## Output Format

```markdown
## Review Result

### ✅ Good Points

- [Good points]

### ⚠️ Improvements Needed

- [Improvement points]

### Recommendation

[Overall evaluation and recommended actions]
```
