# Prompt: Agent Design Retro

Extract reusable design insights from events (incident response, errors, fix PRs, conversations)
and reflect them in design assets for prevention and quality improvement.

## Input

**Required (at least one):**

- Response history (timeline, logs, error messages, fixes)
- Git changes (diff, commit messages)
- **Chat context (conversation history, Q&A exchanges, problem-solving threads)**

**Optional:**

- Terminal history (commands executed, outputs, errors)
- Scope of reflection (Agents.md / \*.agent.md / instructions) — defaults to all

## Steps

### Step 0: Context Collection

1. Read target files:
   - README.md
   - AGENTS.md
   - .github/agents/\*.agent.md
   - .github/instructions/\*_/_.md
   - .github/copilot-instructions.md
2. Summarize existing rules in 5 lines or less

**Example:**

```
Existing rules summary:
- SRP: 1 agent = 1 responsibility
- No git push without confirmation
- Error handling must be explicit
- Idempotency required for all operations
```

### Step 1: Extract Learnings

Identify insights at these levels:

- Design principle (separation of concerns, idempotency)
- Workflow (call order, preconditions, error handling)
- Prompt patterns (effective phrasing, tool usage)

**If no learnings found:**

- Verify input data is sufficient
- Consider if the scope is too narrow
- Report "No actionable learnings identified" and **stop here**

Format: `Learning` → `Evidence` → `Impact`

**Example:**

```
Learning: Break complex tasks into numbered steps
Evidence: Multi-step request succeeded when numbered vs. failed as prose
Impact: Add "numbered steps" pattern to prompt guidelines
```

### Step 2: Decide Action & Target

**Priority:**
| Impact | Recurrence Risk | Priority |
|--------|-----------------|----------|
| High | High | 🔴 P1 |
| High | Low | 🟡 P2 |
| Low | Any | 🟢 P3 |

**Action decision:**
| Frequency | Severity | Action |
|-----------|----------|--------|
| Once | Low | Document in PR only |
| Once | High | Add to specific agent |
| Multiple | Any | Generalize to instructions |
| Chat insight | Reusable | Add to prompts or instructions |

**Target mapping:**
| Learning Type | Target File |
|---------------|-------------|
| Common principle | AGENTS.md |
| Agent-specific | .github/agents/\*.agent.md |
| Workflow rule | .github/instructions/\*.md |
| Prompt pattern | .github/prompts/\*.prompt.md |

### Step 3: Validate & Prepare

**Gate criteria (all must pass before output):**

- [ ] No duplicate rules → verified via grep search
- [ ] Consistent with existing design → cross-referenced AGENTS.md
- [ ] Minimal and focused change → each change < 20 lines (if larger, split)

If any gate fails, fix before proceeding.

## Output Format

⚠️ **Output ONCE using this format only. Do not repeat sections.**

```markdown
# Retro: [Title]

## Learnings

1. **Learning**: [What was learned]

   - Evidence: [What happened]
   - Action: → [target file]

2. **Learning**: [Next learning]
   - Evidence: ...
   - Action: → [target]

## Changes

\`\`\`markdown
[Exact content to add/replace]
\`\`\`

## Review Checkpoint

Before applying changes:

- [ ] User approved proposed changes
- [ ] No conflicts with existing rules verified
- [ ] Target files are writable
```
