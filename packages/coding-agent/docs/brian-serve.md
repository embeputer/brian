# Waking Brian

Brian does most of its work in the background: routines and reminders, the weekly audit, and answering your chats. `brian wake` runs that as a service that starts when you log in.

```bash
brian wake            # install and start the background service
brian wake --status   # running, stopped, or not installed
brian sleep           # stop it and don't start at login
```

`brian hatch` (same as `brian onboard`) asks to wake Brian at the end of setup. `--wake` wakes it without asking, `--no-wake` skips.

| OS | Service | File |
|---|---|---|
| macOS | launchd agent | `~/Library/LaunchAgents/dev.brian.agent.plist` |
| Linux | systemd user service | `~/.config/systemd/user/brian.service` |

Logs go to `~/.brian/agent/logs/serve.log`. On Linux, user services stop when you log out; run `loginctl enable-linger $USER` to keep Brian running on a server. Windows isn't supported yet. Run `brian serve` in a terminal instead.

`brian uninstall --yes` also removes the service.

## brian serve

The service runs `brian serve`. You can run it yourself in the foreground:

```bash
brian serve [--port 7333] [--host 127.0.0.1] [--no-routines] [--no-gateway]
```

It runs:

- **routines**: due reminders and tasks every 30s, including the weekly audit when scheduled (`brian audit --schedule`);
- **gateway**: your chats through Beeper every 30s, once `brian connect beeper` is done (no restart needed);
- **local API** on `127.0.0.1:7333` for apps such as the desktop app.

## Local API

The token is created on first start and stored in `~/.brian/agent/serve.json` (mode `0600`). Send it as `Authorization: Bearer <token>`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v1/health` | | `{ ok, name, version }` (no token needed) |
| GET | `/v1/status` | | loops, routine count, Beeper connection, pending drafts |
| POST | `/v1/prompt` | `{ "prompt": "..." }` | `{ "text": "..." }` |

```bash
TOKEN=$(node -p 'require(process.env.HOME + "/.brian/agent/serve.json").token')
curl -s -H "Authorization: Bearer $TOKEN" -d '{"prompt":"what is on my plate today?"}' http://127.0.0.1:7333/v1/prompt
```
