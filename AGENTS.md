# Agent Skills

<!-- agent-ninja-START -->
## Agent Resources

> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.
> Read the relevant resource file before working on tasks covered by these resources.

### Skills

| Resource | Source | Path | Description |
|----------|--------|------|-------------|
| [agentic-workflow-guide](.github/skills/agentic-workflow-guide/SKILL.md) | aktsmm-Agent-Skills | `.github/skills/agentic-workflow-guide` | Design, review, and debug agent workflows, and decide when a request should use a prompt, instruction, skill, agent, or hook before escalating to multi-agent design. |
| [book-writing-workspace](.github/skills/book-writing-workspace/SKILL.md) | aktsmm-Agent-Skills | `.github/skills/book-writing-workspace` | Operate a reusable technical book manuscript workspace with writing structure, review rules, and optional Markdown to Re:VIEW/PDF support. |
| [duck-critic](.github/skills/duck-critic/SKILL.md) | aktsmm-Agent-Skills | `.github/skills/duck-critic` | Run a Duck Critic producer-critic loop: you (main) keep producing the plan/code/tests and gate your own work at checkpoints with a different-model critic, revising until it passes. |
| [skill-creator-plus](.github/skills/skill-creator-plus/SKILL.md) | aktsmm-Agent-Skills | `.github/skills/skill-creator-plus` | Create or review a reusable skill (SKILL.md) that packages a workflow, and decide whether the request should be a skill instead of a prompt, instruction, agent, or hook. |
| [vscode-extension-guide](.github/skills/vscode-extension-guide/SKILL.md) | aktsmm-Agent-Skills | `.github/skills/vscode-extension-guide` | Guide for creating VS Code extensions and plugins from scratch through Marketplace publication. |

<!-- agent-ninja-END -->

## Related Projects

- Sibling project "Agent Resources Ninja" (public): https://github.com/aktsmm/vscode-agent-resources-ninja
- Shares implementation structure such as `src/githubAuth.ts`, `*.githubToken` settings, and post-install TreeView reveal, so fixes in one repo are often portable to the other.
- Example: porting Skills Ninja v0.9.30 secure GitHub auth / install-flow hardening → https://github.com/aktsmm/vscode-agent-resources-ninja/issues/1
