# Brian routines and inter-Brian

## Routines

Routines are reminders and scheduled tasks. They are stored in `~/.brian/agent/routines.json` and need no server.

- `reminder`: shows the text as a notification (`osascript` on macOS, `notify-send` on Linux) and prints it.
- `task`: runs the text as a Brian prompt (`brian -p <text>`), then notifies with the result.

Brian creates them with the `routines` tool when you ask ("remind me to call mom in 30m", "every weekday at 8 summarize my inbox"). You can manage them from the CLI:

```bash
brian routines add "call mom" --when 30m
brian routines add "summarize my unread email" --task --when "8am" --every daily --tz Europe/Vilnius
brian routines list
brian routines pause <id>      # resume <id>, remove <id>
brian routines history [id]
brian routines run [id]        # run due routines once, or one routine now
brian routines daemon          # keep running due routines (check every 30s)
```

`--when` accepts `30m`, `2h`, `3d`, or natural language (`tomorrow 9am`, `friday 17:00`). `--every` accepts `once` (default), `daily`, `weekly`, `every 30m`, `every 2h`, or a five-field cron expression. Times use `--tz` or the system timezone.

Routines run only while `brian routines daemon` runs, or when something calls `brian routines run` (for example a system cron entry). One-shot routines are disabled after they run. A failed run records the error and stays scheduled.

## Inter-Brian

The `brians` tool lets one Brian talk to other Brians on the same machine. It replaces the old `a2a` and `collab` tools.

- `list`: show reachable Brians.
- `send`: hand a self-contained task to a Brian by name and return its reply.
- `review`: send the git diff of a workspace (working tree vs `HEAD`, or `<base>...HEAD`) and ask the peer to reply `APPROVE` or `CHANGES` with findings.

Start Brians with names so they can find each other:

```bash
BRIAN_NAME=work brian --mode rpc
BRIAN_NAME=school brian --mode rpc
```

See [environment variables](environment-variables.md#inter-brian-discovery) for the host, port, and discovery directory settings.
