# Environment Variables

Brian uses environment variables in three ways:

- Variables such as `BRIAN_OFFLINE` configure the Brian process.
- Brian sets process markers so child processes can identify Brian as the launching agent.
- Commands run by the LLM-callable shell tools receive `BRIAN_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#use-an-api-key-from-the-environment).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=brian` is a generic marker that lets tooling identify Brian as the agent that launched the process.
- `BRIAN_AGENT=true` is Brian-specific and lets child processes detect that they run inside Brian.

Child processes inherit both markers. They are not session-specific and are not set automatically when Brian is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current Brian session state:

| Variable | Description |
|----------|-------------|
| `BRIAN_SESSION_ID` | Current session ID |
| `BRIAN_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `BRIAN_PROVIDER` | Currently selected model provider |
| `BRIAN_MODEL` | Currently selected model ID |
| `BRIAN_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting Brian. `BRIAN_PROVIDER` and `BRIAN_MODEL` identify the selected Brian model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$BRIAN_PROVIDER" "$BRIAN_MODEL"
printf 'reasoning=%s session=%s\n' "$BRIAN_REASONING_LEVEL" "$BRIAN_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$BRIAN_SESSION_FILE" ]; then
  tail -n 1 "$BRIAN_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with Brian. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, Brian removes inherited values for these variables so nested Brian processes do not expose stale parent-session metadata.

## Brian Process Configuration

These variables are read by Brian itself:

| Variable | Description |
|----------|-------------|
| `BRIAN_AGENT_DIR` | Override the config directory; default is `~/.brian/agent` |
| `BRIAN_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `BRIAN_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `BRIAN_OFFLINE` | Disable automatic network activity, including model catalog refreshes |
| `BRIAN_SKIP_VERSION_CHECK` | Disable the npm registry latest-version request |
| `BRIAN_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `BRIAN_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `BRIAN_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `BRIAN_RADIUS_GATEWAY` | Override the Radius gateway origin used by `/bug` uploads |
| `BRIAN_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `BRIAN_CLIPBOARD_OSC52` | Set to `1` to also send copied text to the terminal with OSC 52 after the local clipboard write, as Brian does over SSH. Use it when a remote client reaches Brian without SSH variables, such as a multiplexer attached from another machine or a remote IDE daemon |
| `BRIAN_HYPERLINKS` | Override OSC 8 hyperlink detection with `1`, `0`, or `auto` |
| `BRIAN_PROGRAM_STATUS` | Override OSC 7501 program status detection: `1` always reports, `0` never reports; otherwise Brian reports only after the terminal confirms support. See [Terminal setup](terminal-setup.md#program-status) |
| `BRIAN_IMAGE_PROTOCOL` | Override inline image detection with `kitty`, `iterm2`, `none`, or `auto` |
| `BRIAN_TRUE_COLOR` | Override truecolor detection with `1`, `0`, or `auto` |
| `BRIAN_TUI_ESC_TIMEOUT` | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and cloud-provider configuration are listed in [Providers](providers.md#environment-variables-or-auth-file).

## Brian sandbox A2A discovery

When `SANDBOX_NAME` is set, or `BRIAN_A2A=1`, a brian sandbox starts a loopback A2A server and advertises it so other sandboxes on the same machine can connect. Set `BRIAN_A2A=0` to disable.

| Variable | Description |
|----------|-------------|
| `SANDBOX_NAME` | Sandbox identity used in A2A advertisements and collab |
| `BRIAN_A2A` | `1` enables discovery without `SANDBOX_NAME`; `0` disables it |
| `BRIAN_A2A_DISCOVERY_DIR` | Directory for advertisement files; default is `$XDG_RUNTIME_DIR/brian/a2a` or a per-user temp dir |
| `BRIAN_A2A_HOST` | Bind host for the A2A listener; default `127.0.0.1` |
| `BRIAN_A2A_PORT` | Bind port; default `0` (ephemeral) |
| `BRIAN_A2A_ADVERTISE_HOST` | Host written into the advertised URL when it should differ from the bind address |
| `BRIAN_A2A_ADVERTISE_URL` | Full advertised A2A URL override |
