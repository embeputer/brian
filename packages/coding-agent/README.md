<p align="center">
  <a href="https://pi.dev">
    <img alt="Brian logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@brian-agent/cli"><img alt="npm" src="https://img.shields.io/npm/v/@brian-agent/cli?style=flat-square&logo=npm&logoColor=white" /></a>
</p>

> New issues and PRs from new contributors are closed automatically. Maintainers review closed submissions daily. See [CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md).

# Brian

Brian is a minimal, extensible agent harness that you can make your own.

Adapt Brian to your workflows, not the other way around. Customize Brian with [extensions](docs/extensions.md), [skills](docs/skills.md), and [prompt templates](docs/prompt-templates.md). Bundle them as [Brian packages](docs/packages.md) and share via npm or git.

Brian ships with powerful defaults but skips features like sub-agents and plan mode. Ask Brian to build what you want, or install a package that does it your way.

Use Brian in [print or JSON mode](docs/cli.md), control it over [RPC](docs/rpc.md), or build apps with the [Brian TypeScript SDK](docs/sdk.md). See [OpenClaw](https://github.com/OpenClaw/OpenClaw) for a real-world integration.

Brian runs in print or JSON, RPC for process integration, and an SDK for embedding in your own apps. Interactive TUI mode has been removed.

## Share your OSS coding agent sessions

If you use brian for open source work, please share your coding agent sessions.

Public OSS session data helps improve models, prompts, tools, and evaluations using real development workflows.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `brian-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## Table of Contents

- [Quick Start](#quick-start)
- [Providers & Models](#providers--models)
- [Headless modes](#headless-modes)
  - [Commands](#commands)
- [Sessions](#sessions)
  - [Branching](#branching)
  - [Compaction](#compaction)
- [Settings](#settings)
- [Context Files](#context-files)
- [Customization](#customization)
  - [Prompt Templates](#prompt-templates)
  - [Skills](#skills)
  - [Extensions](#extensions)
  - [Brian Packages](#brian-packages)
- [Programmatic Usage](#programmatic-usage)
- [Philosophy](#philosophy)
- [CLI Reference](#cli-reference)

---

## Quick Start

```bash
npm install -g --ignore-scripts @brian-agent/cli
```

Brian requires Node.js 22.19 or newer. The macOS, Linux, and Windows installers can install it if needed. Brian does not require dependency lifecycle scripts for a normal npm installation.

Authenticate with an API key, then run in print mode:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
brian -p "Say hello"
```

For process integration, use RPC (`brian --mode rpc` or `rpc-entry`). Extension commands, skill commands, and prompt templates can be sent as prompts, and the host answers `ctx.ui` dialogs. Built-in actions use dedicated RPC commands. See [docs/rpc.md](docs/rpc.md).

To embed brian in your own app, use the SDK (`createAgentSession`). See [Programmatic Usage](#programmatic-usage).

By default, brian gives the model four tools: `read`, `write`, `edit`, and `bash`. The model uses these to fulfill your requests. Add capabilities via [skills](#skills), [prompt templates](#prompt-templates), [extensions](#extensions), or [brian packages](#brian-packages).

**Platform notes:** [Windows](docs/windows.md) | [Termux (Android)](docs/termux.md) | [Shell aliases](docs/shell-aliases.md)

---

## Providers & Models

For each built-in provider, brian maintains a list of tool-capable models. Configured provider catalogs refresh automatically; run `brian update --models` to force an immediate refresh. Authenticate with an API key or preconfigured subscription credentials, then select a model with `--provider` and `--model`, the RPC `set_model` command, or the SDK.

**Subscriptions:**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot

**API keys:**
- Anthropic
- Ant Ling
- OpenAI
- Azure OpenAI
- DeepSeek
- NVIDIA NIM
- Google Gemini
- Google Vertex
- Amazon Bedrock
- Mistral
- Groq
- Cerebras
- Cloudflare AI Gateway
- Cloudflare Workers AI
- xAI
- OpenRouter
- Vercel AI Gateway
- ZAI Coding Plan (Global)
- ZAI Coding Plan (China)
- OpenCode Zen
- OpenCode Go
- Hugging Face
- Fireworks
- Together AI
- Baseten
- Kimi For Coding
- Meta
- MiniMax
- Xiaomi MiMo
- Xiaomi MiMo Token Plan (China)
- Xiaomi MiMo Token Plan (Amsterdam)
- Xiaomi MiMo Token Plan (Singapore)

Brian also supports the llama.cpp router server. Configure it with environment variables, manage downloads and loaded models with the `/llama` extension command, then select a loaded model through CLI, RPC, or SDK model selection. See [docs/llama-cpp.md](docs/llama-cpp.md) for setup and usage.

See [docs/providers.md](docs/providers.md) for other provider setup instructions.

**Custom providers & models:** Add providers via `~/.brian/agent/models.json` if they speak a supported API (OpenAI, Anthropic, Google). For custom APIs or OAuth, use extensions. See [docs/models.md](docs/models.md) and [docs/custom-provider.md](docs/custom-provider.md).

---

## Headless modes

Interactive TUI mode has been removed. Use print (`-p`), JSON (`--mode json`), RPC (`--mode rpc` / `rpc-entry`), or the SDK.

Extension commands, skill commands, prompt templates, and extension UI dialogs work over RPC. Built-in actions use dedicated RPC commands.

### Commands

Send extension commands as prompts over RPC or in print mode. [Skills](#skills) are available as `/skill:name`, and [prompt templates](#prompt-templates) expand via `/templatename`. Built-in TUI slash commands are not handled in headless modes. RPC exposes model, session, compaction, export, and other operations as JSON commands; see [RPC mode](docs/rpc.md).

---

## Sessions

Sessions are stored as JSONL files with a tree structure. Each entry has an `id` and `parentId`, enabling in-place branching without creating new files. See [docs/session-format.md](docs/session-format.md) for file format.

### Management

Sessions auto-save to `~/.brian/agent/sessions/` organized by working directory.

```bash
brian -c                  # Continue most recent session
brian -r                  # Continue most recent session
brian --no-session        # Ephemeral mode (don't save)
brian --name "my task"    # Set session display name at startup
brian --session <path|id> # Use specific session file or ID
brian --fork <path|id>    # Fork specific session file or ID into a new session
```

Use the RPC `get_state` command to read the current session ID before reusing it with `--session <id>` or `--fork <id>`.

### Branching

RPC clients can inspect the append-only session tree with `get_tree`. Use `fork` with a selected entry ID to create a session from an earlier user message, or `clone` to duplicate the active branch at its current position.

**`--fork <path|id>`** - Fork an existing session file or partial session UUID directly from the CLI. This copies the full source session into a new session file in the current project.

### Compaction

Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

**Manual:** Send the RPC `compact` command, optionally with `customInstructions`, or call `session.compact()` through the SDK.

**Automatic:** Enabled by default. Triggers on context overflow (recovers and retries) or when approaching the limit (proactive). Configure it in `settings.json` or with the RPC `set_auto_compaction` command.

Compaction is lossy. The full history remains in the JSONL file and is available through RPC tree and entry commands. Customize compaction behavior via [extensions](#extensions). See [docs/compaction.md](docs/compaction.md) for internals.

Session model context is projected from append-only history. Extensions can append a `context_edit` to omit or replace an earlier message only for future model requests; raw history and usage remain unchanged:

```typescript
const assistantId = sessionManager.appendMessage(partialAssistant);
sessionManager.appendContextEdit(assistantId, null); // Hidden from model context, retained in JSONL.
```

A retain-none compaction uses `appendCompaction(summary, null, tokensBefore)` to make the exact summary the new context root while preserving prior raw entries.

---

## Settings

Edit settings files directly:

| Location | Scope |
|----------|-------|
| `~/.brian/agent/settings.json` | Global (all projects) |
| `.brian/settings.json` | Project (overrides global) |

See [docs/settings.md](docs/settings.md) for all options.

### Project Trust

Trusting a project allows brian to load `.brian/settings.json` and `.brian` resources, install missing project packages, and execute project extensions.

Before the trust decision, brian loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.brian/agent/settings.json`.

`brian config` and package commands use the same project trust flow, except `brian update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

### Telemetry and update checks

Brian has two separate startup features:

- **Update check:** fetches `https://registry.npmjs.org/@brian-agent/cli/latest` to check whether a newer Brian version exists. Disable it with `BRIAN_SKIP_VERSION_CHECK=1`. Disabling update checks only turns off this check.
- **Install/update telemetry:** after first install or a changelog-detected update, sends an anonymous version ping to `BRIAN_TELEMETRY_URL` when that is set (nothing is sent otherwise). This setting also controls optional provider attribution headers for OpenRouter, Cloudflare, and direct NVIDIA NIM requests. Opt out by setting `enableInstallTelemetry` to `false` in `settings.json`, or by setting `BRIAN_TELEMETRY=0`. This does not disable update checks; Brian may still query the npm registry for the latest version unless update checks are disabled or offline mode is enabled.

Use `--offline` or `BRIAN_OFFLINE=1` to disable all startup network operations described here, including update checks, package update checks, and install/update telemetry.

---

## Context Files

Brian loads `AGENTS.md` (or `CLAUDE.md`) at startup from:
- `~/.brian/agent/AGENTS.md` (global)
- Parent directories (walking up from cwd)
- Current directory

If a directory contains `AGENTS.override.md`, Brian loads it instead of `AGENTS.md` or `CLAUDE.md` from that directory. Context files from other directories are still concatenated.

Use for project instructions (`AGENTS.md`/`CLAUDE.md`), conventions, common commands. All matching files are concatenated.

Disable context file loading with `--no-context-files` (or `-nc`).

### System Prompt

Replace the opening of the default system prompt with `.brian/SYSTEM.md` (project) or `~/.brian/agent/SYSTEM.md` (global). The tool list and rules still follow it. Append without replacing via `APPEND_SYSTEM.md`.

---

## Customization

### Prompt Templates

Reusable prompts as Markdown files. Send `/name` as a prompt to expand one.

```markdown
<!-- ~/.brian/agent/prompts/review.md -->
Review this code for bugs, security issues, and performance problems.
Focus on: {{focus}}
```

Place in `~/.brian/agent/prompts/`, `.brian/prompts/`, or a [brian package](#brian-packages) to share with others. See [docs/prompt-templates.md](docs/prompt-templates.md).

### Skills

On-demand capability packages following the [Agent Skills standard](https://agentskills.io). Invoke via `/skill:name` or let the agent load them automatically.

```markdown
<!-- ~/.brian/agent/skills/my-skill/SKILL.md -->
# My Skill
Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
```

Place in `~/.brian/agent/skills/`, `~/.agents/skills/`, `.brian/skills/`, or `.agents/skills/` (from `cwd` up through parent directories) or a [brian package](#brian-packages) to share with others. See [docs/skills.md](docs/skills.md).

### Extensions

<p align="center"><img src="docs/images/doom-extension.png" alt="Doom Extension" width="600"></p>

TypeScript modules that extend brian with custom tools, commands, event handlers, dialogs, and provider integrations.

```typescript
export default function (brian: ExtensionAPI) {
  brian.registerTool({ name: "deploy", ... });
  brian.registerCommand("stats", { ... });
  brian.on("tool_call", async (event, ctx) => { ... });
}
```

`turn_end` and `agent_before_settle` are actionable persistence boundaries. Handlers can append structural entries and request one continuation. Later handlers see earlier proposals:

```typescript
let replacedResponse = false;
brian.on("turn_end", (event) => {
  if (replacedResponse || event.outcome !== "completed" || event.toolResults.length > 0) return;
  replacedResponse = true;
  return {
    entries: [
      ...event.entries,
      { type: "context_edit", targetId: event.messageEntryId, replacement: null },
      {
        type: "custom_message",
        customType: "replacement-instruction",
        content: "Answer again using the persisted user request.",
        display: false,
      },
    ],
    continue: true,
  };
});
```

Continuation is one-shot per boundary result, not per registered handler. It ensures one next provider request: tool-result, steering, or follow-up scheduling can satisfy that request without adding another one; otherwise Brian makes one context-only request. Guard handlers like the example above because an unconditional `continue: true` is evaluated again after the next response and can loop indefinitely. Error and aborted responses remain hard exits.

Use `agent_before_settle` for final actions after retries, compaction, and queued input are exhausted. See [docs/extensions.md](docs/extensions.md#agent_start--agent_end--agent_before_settle--agent_settled).

The default export can also be `async`. brian waits for async extension factories before startup continues, which is useful for one-time initialization such as fetching remote model lists before calling `brian.registerProvider()`.

**What's possible:**
- Custom tools (or replace built-in tools entirely)
- Sub-agents and plan mode
- Custom compaction and summarization
- Permission gates and path protection
- RPC-backed dialogs and notifications
- Git checkpointing and auto-commit
- SSH and sandbox execution
- MCP server integration
- ...anything you can dream up

Place in `~/.brian/agent/extensions/`, `.brian/extensions/`, or a [brian package](#brian-packages) to share with others. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/](examples/extensions/).


### Brian Packages

Bundle and share extensions, skills, and prompts via npm or git. Find packages on [npmjs.com](https://www.npmjs.com/search?q=keywords%3Api-package) or [Discord](https://discord.com/channels/1456806362351669492/1457744485428629628).

> **Security:** Brian packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

Packages install to `~/.brian/agent/git/` (git) or `~/.brian/agent/npm/` (npm). Use `-l` for project-local installs (`.brian/git/`, `.brian/npm/`). Git `@ref` values are pinned tags or commits; pinned packages are skipped by `brian update --extensions` and `brian update --all`, so use `brian install git:host/user/repo@new-ref` to move an existing package to a new ref. Git packages install dependencies with `npm install --omit=dev` by default, so runtime deps must be listed under `dependencies`; when `npmCommand` is configured, git packages use plain `install` for compatibility with wrappers. If you use a Node version manager and want package installs to reuse a stable npm context, set `npmCommand` in `settings.json`, for example `["mise", "exec", "node@20", "--", "npm"]`.

Create a package by adding a `brian` key to `package.json`:

```json
{
  "name": "my-brian-package",
  "keywords": ["brian-package"],
  "brian": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

Without a `brian` manifest, brian auto-discovers from conventional directories (`extensions/`, `skills/`, `prompts/`).

See [docs/packages.md](docs/packages.md).

---

## Programmatic Usage

### SDK

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@brian-agent/cli";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

await session.prompt("What files are in the current directory?");
```

For advanced multi-session runtime replacement, use `createAgentSessionRuntime()` and `AgentSessionRuntime`.

See [docs/sdk.md](docs/sdk.md) and [examples/sdk/](examples/sdk/).

### RPC Mode

For non-Node.js integrations, use RPC mode over stdin/stdout:

```bash
brian --mode rpc
```

RPC mode uses strict LF-delimited JSONL framing. Clients must split records on `\n` only. Do not use generic line readers like Node `readline`, which also split on Unicode separators inside JSON payloads.

See [docs/rpc.md](docs/rpc.md) for the protocol.

---

## Philosophy

Brian is aggressively extensible so it doesn't have to dictate your workflow. Features that other tools bake in can be built with [extensions](#extensions), [skills](#skills), or installed from third-party [brian packages](#brian-packages). This keeps the core minimal while letting you shape brian to fit how you work.

**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)), or build an extension that adds MCP support. [Why?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**No sub-agents.** There's many ways to do this. Spawn brian instances via tmux, or build your own with [extensions](#extensions), or install a package that does it your way.

**No permission popups.** Run in a container, or build your own confirmation flow with [extensions](#extensions) inline with your environment and security requirements.

**No plan mode.** Write plans to files, or build it with [extensions](#extensions), or install a package.

**No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with [extensions](#extensions).

**No background bash.** Use tmux. Full observability, direct interaction.

Read the [blog post](https://mariozechner.at/posts/2025-11-30-brian-coding-agent/) for the full rationale.

---

## CLI Reference

```bash
brian [options] [--] [@files...] [messages...]
```

### Package Commands

```bash
brian install <source> [-l]     # Install package, -l for project-local
brian remove <source> [-l]      # Remove package
brian uninstall <source> [-l]   # Alias for remove
brian update [source|self|brian]   # Update brian only, or one package source
brian update --all              # Update brian and packages
brian update --extensions       # Update packages only
brian update --models           # Refresh model catalogs only
brian update --self             # Update brian only
brian update --self --force     # Reinstall brian even if current
brian update --extension <src>  # Update one package
brian list                      # List installed packages
brian config                    # Enable/disable package resources
```

`brian config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `brian update` never prompts for project trust.

### Modes

| Flag | Description |
|------|-------------|
| (default) / `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines (see [docs/json.md](docs/json.md)) |
| `--mode rpc` | RPC mode for process integration (see [docs/rpc.md](docs/rpc.md)) |
| `--export <in> [out]` | Export session to HTML |

In print mode, brian also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | brian -p "Summarize this text"
```

### Model Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider (anthropic, openai, google, etc.) |
| `--model <pattern>` | Model ID or partial match (warns), supports `provider/id` and optional `:<thinking>` |
| `--api-key <key>` | API key (overrides env vars) |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--models <patterns>` | Comma-separated model patterns or globs (e.g. `openrouter/*`) available to the session |
| `--list-models [search]` | List available models |

### Session Options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue most recent session |
| `-r`, `--resume` | Continue most recent session |
| `--session <path\|id>` | Use specific session file or partial UUID |
| `--fork <path\|id>` | Fork specific session file or partial UUID into a new session |
| `--session-dir <dir>` | Custom session storage directory |
| `--no-session` | Ephemeral mode (don't save) |
| `--name <name>`, `-n <name>` | Set session display name at startup |

### Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>`, `-t <list>` | Allowlist specific tool names across built-in, extension, and custom tools |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific tool names across built-in, extension, and custom tools |
| `--no-builtin-tools`, `-nbt` | Disable built-in tools by default but keep extension/custom tools enabled |
| `--no-tools`, `-nt` | Disable all tools by default |

Available built-in tools: `read`, `bash`, `powershell` (Windows), `edit`, `write`, `grep`, `find`, `ls`

### Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load extension from path, npm, or git (repeatable) |
| `--no-extensions` | Disable extension discovery |
| `--skill <path>` | Load skill (repeatable) |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load prompt template (repeatable) |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--no-context-files`, `-nc` | Disable AGENTS.md and CLAUDE.md context file discovery |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings.json (e.g., `--no-extensions -e ./my-ext.ts`).

### Other Options

| Option | Description |
|--------|-------------|
| `--system-prompt <text>` | Replace the default prompt's opening (tools, rules, context files, and skills still appended) |
| `--append-system-prompt <text>` | Append to system prompt |
| `--verbose` | Force verbose startup |
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |
| `--` | Stop option parsing; remaining arguments are prompts or `@file` inputs |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### File Arguments

Prefix files with `@` to include in the message:

```bash
brian @prompt.md "Answer this"
brian -p @screenshot.png "What's in this image?"
brian @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Print mode
brian -p "List all .ts files in src/"

# Print mode
brian -p "Summarize this codebase"

# Prompt beginning with a dash
brian -p -- "- Summarize these points"

# Non-interactive with piped stdin
cat README.md | brian -p "Summarize this text"

# Named one-shot session
brian --name "release audit" -p "Audit this repository"

# Different model
brian --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix (no --provider needed)
brian --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
brian --model sonnet:high "Solve this complex problem"

# Limit the models available to the session
brian --models "claude-*,gpt-4o"

# Read-only mode
brian --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
brian --exclude-tools ask_question

# High thinking level
brian --thinking high "Solve this complex problem"
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AI_AGENT` | Set to `brian` by the CLI and RPC entry points so generic tooling can attribute child processes to Brian |
| `BRIAN_AGENT` | Set to `true` by the CLI and RPC entry points so child processes can detect that they run inside Brian |
| `BRIAN_AGENT_DIR` | Override config directory (default: `~/.brian/agent`) |
| `BRIAN_SESSION_DIR` | Override session storage directory (overridden by `--session-dir`) |
| `BRIAN_PACKAGE_DIR` | Override package directory (useful for Nix/Guix where store paths tokenize poorly) |
| `BRIAN_OFFLINE` | Disable startup network operations, including update checks, package update checks, and install/update telemetry |
| `BRIAN_SKIP_VERSION_CHECK` | Skip the Brian version update check at startup. This prevents the npm registry latest-version request |
| `BRIAN_TELEMETRY` | Override install/update telemetry and provider attribution headers. Use `1`/`true`/`yes` to enable or `0`/`false`/`no` to disable. This does not disable update checks |
| `BRIAN_CACHE_RETENTION` | Set to `long` for extended prompt cache (Anthropic: 1h, OpenAI: 24h) |
| `VISUAL`, `EDITOR` | Fallback external editor for Ctrl+G when `externalEditor` is unset; defaults to Notepad on Windows and `nano` elsewhere |

Commands run by the LLM-callable `bash` and `powershell` tools also receive current session metadata:

| Variable | Description |
|----------|-------------|
| `BRIAN_SESSION_ID` | Current session ID |
| `BRIAN_SESSION_FILE` | Absolute session JSONL path; unset for ephemeral sessions |
| `BRIAN_PROVIDER` | Currently selected model provider |
| `BRIAN_MODEL` | Currently selected model ID |
| `BRIAN_REASONING_LEVEL` | Current effective reasoning level |

These values are resolved when each command starts. See [Environment Variables](docs/environment-variables.md#shell-tool-session-environment) for semantics, examples, and custom-tool opt-out.

---

## Contributing & Development

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines and [docs/development.md](docs/development.md) for setup, forking, and debugging.

## License

MIT

## See Also

- [@brian-agent/ai](https://www.npmjs.com/package/@brian-agent/ai): Core LLM toolkit
- [@brian-agent/agent](https://www.npmjs.com/package/@brian-agent/agent): Agent framework

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
