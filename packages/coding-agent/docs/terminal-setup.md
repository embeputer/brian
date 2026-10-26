# Configure your terminal

Most modern terminals work with Brian without additional setup. Use this page when modified keys, scrolling, links, images, colors, or input-method editor (IME) positioning do not behave as expected.

Brian uses extended-key protocols so terminals can distinguish combinations such as `Shift+Enter` and `Alt+Enter` from plain `Enter`. Terminal proxies, multiplexers, and built-in IDE terminals can change or discard that information.

Brian auto-detects truecolor support for themed output. If detection fails behind a terminal proxy or multiplexer, use this advanced override:

| Capability | Environment variable | JSON setting |
|------------|----------------------|--------------|
| Truecolor | `BRIAN_TRUE_COLOR=1\|0\|auto` | `terminal.trueColor: true\|false\|"auto"` |

Use `/hotkeys` to inspect Brian's active shortcuts. See [Keybindings](keybindings.md) to change them.

## Terminal emulators

Brian's headless modes do not capture keyboard or mouse input and do not use an alternate screen. Terminal-specific key mappings, fullscreen scrolling workarounds, and hardware-cursor settings are not required. An RPC client owns its own input and display behavior.
