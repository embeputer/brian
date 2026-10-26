# Quickstart

Brian runs in your terminal and works with files on your machine. To use it, you need access to a model through a supported provider. This can be a subscription, an API key, or a local model.

For native Windows setup, read [Windows Setup](windows.md). For Android, read [Termux Setup](termux.md).

## 1. Install Brian

On macOS or Linux, you can use the installer:

```bash
npm install -g --ignore-scripts @brian-agent/cli
```

The installer pins all dependencies and updates Brian with `brian update`. Alternatively, install Brian from npm with the fork's generated shrinkwrap. This requires Node.js 22.19 or newer:

```bash
npm install -g --ignore-scripts @brian-agent/cli
```

Brian does not require dependency lifecycle scripts for a normal npm installation.

Verify the installation:

```bash
brian --version
```

## 2. Start Brian

Change to the folder you want Brian to work with, then start it:

```bash
cd /path/to/folder
brian
```

The working folder helps Brian discover relevant files, instructions, and configuration. Brian also uses it to group saved sessions.

<p align="center"><img src="images/interactive-mode.png" alt="Brian running in a terminal with a conversation, input editor, and status footer" width="750"></p>

The interface shows your conversation, an editor for prompts and commands, and a footer with the current folder, model, and session status. See [Use Brian in the terminal](usage.md) to learn how to add files, run commands, direct ongoing work, and manage results.

## 3. Choose a model

A **model** generates Brian's responses. A **provider** is the service or account Brian uses to access that model.

In Brian, run:

```text
/login
```

Choose a provider, then follow the prompts to use a subscription or store an API key. Run `/model` afterward if you want to select a different available model.

See [Choose a model and provider](models.md) for supported providers, environment-variable authentication, local models, and custom endpoints.

## 4. Give Brian a task

Brian shows each file read, search, command, and edit it performs. It does not ask before every tool call.

Enter a task that matches your work, for example:

```text
Summarize @meeting-notes.md and save the action items to action-items.md.
```

```text
Explain how this repository is structured and how to run its checks.
```

```text
Compare @previous.csv with @current.csv and summarize the important changes.
```

Type `@` in the editor to search for a file instead of entering its full path. When Brian finishes, review its response and any changed files. Use version control or backups for important work. For untrusted or unattended work, use a container or another sandbox. See [Security](security.md).

## Continue later

Brian saves sessions automatically. Exit Brian, then resume the most recent session for the same working folder with:

```bash
brian --continue
```

Use `/resume` to choose another saved session. See [Continue or branch a session](sessions.md) for session naming, branching, compaction, export, and sharing.

## Next steps

- [Use Brian interactively](usage.md) to learn input, commands, shortcuts, and queued messages.
- [Add instructions](configuration.md#context-files) that Brian should follow whenever it works in a folder.
- [Choose a model and provider](models.md).

### Choose how to customize Brian

Start with the least powerful mechanism that meets your need:

| Need | Start with |
|---|---|
| Give Brian persistent instructions for a folder | [`AGENTS.md`](configuration.md#context-files) |
| Reuse a prompt from the `/` menu | [Prompt template](prompt-templates.md) |
| Add task-specific instructions and supporting files | [Skill](skills.md) |
| Add executable tools, commands, or event handlers | [Extension](extensions.md) |
| Connect an unsupported model service | [Custom provider](custom-provider.md) |
| Install or distribute several resources | [Brian package](packages.md) |

## Uninstall Brian

If you installed Brian with npm, run:

```bash
npm uninstall -g @brian-agent/cli
```

If you used the installer, run it again and choose **Uninstall Brian**:

```bash
npm install -g --ignore-scripts @brian-agent/cli
```

Neither method removes configuration, credentials, sessions, or installed Brian packages from `~/.brian/agent/`.
