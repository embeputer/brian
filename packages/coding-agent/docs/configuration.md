# Configuration

Brian supports user-level and project configuration. User-level configuration lives in the agent directory, which defaults to `~/.brian/agent`. Project configuration lives in `.brian` under the working directory and loads after [project trust](security.md#understand-project-trust) is granted. The only exception is `sessionDir`, which Brian reads before resolving trust so it can locate sessions.

Ask Brian to update the configuration or edit the relevant files directly. Run `/reload` after manually changing settings, keybindings, instructions, or resources.

## Agent directory

The agent directory is shown as `<agent-dir>` below. Set its location with the `BRIAN_AGENT_DIR` environment variable or the SDK's [`agentDir`](sdk.md) option.

| Path | Responsibility |
|---|---|
| `<agent-dir>/settings.json` | User-level [settings](settings.md), including preferences, defaults, resource paths, and Brian package declarations. |
| `<agent-dir>/mcp.json` | [MCP servers](mcp.md) available in every project. |
| `<agent-dir>/models.json` | [Compatible endpoints, models, and model overrides](models.md#configure-a-compatible-endpoint). |
| `<agent-dir>/auth.json` | Saved API keys and OAuth credentials. |
| `<agent-dir>/AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` | User instructions applied across working directories. |
| `<agent-dir>/SYSTEM.md` | Replaces the opening of Brian’s default system prompt. The tool list and rules still follow it. |
| `<agent-dir>/APPEND_SYSTEM.md` | Adds instructions to Brian’s system prompt. |
| `<agent-dir>/extensions/` | User [extensions](extensions.md). |
| `<agent-dir>/skills/` | User [skills](skills.md) and supporting files. |
| `<agent-dir>/prompts/` | User [prompt templates](prompt-templates.md) exposed as slash commands. |

## Project `.brian` directory

| Path | Responsibility |
|---|---|
| `.brian/settings.json` | Project-level [settings](settings.md), resource paths, and Brian package declarations. |
| `.brian/mcp.json` | Project [MCP servers](mcp.md). |
| `.brian/SYSTEM.md` | Replaces the opening of the system prompt for the project. The tool list and rules still follow it. |
| `.brian/APPEND_SYSTEM.md` | Adds project-specific instructions to the system prompt. |
| `.brian/extensions/` | Project extensions. |
| `.brian/skills/` | Project skills and supporting files. |
| `.brian/prompts/` | Project prompt templates exposed as slash commands. |
| `.brian/themes/` | Project theme files. |

For `SYSTEM.md` and `APPEND_SYSTEM.md`, the trusted project file takes precedence over the corresponding agent-directory file. Files with the same name are not combined.

## Context files

Context files are separate from project `.brian` configuration. Brian loads them from the agent directory, the working directory, and its parent directories. A context file applies whenever Brian runs in its directory or anywhere below it.

An `AGENTS.override.md` replaces `AGENTS.md` or `CLAUDE.md` only in the same directory. It does not suppress context files from the agent directory or other directories.

Context-file discovery does not require project trust.
