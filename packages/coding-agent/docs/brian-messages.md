# Messages and the Gateway

Brian reads and answers your chats through [Beeper Desktop](https://www.beeper.com/), which puts Discord, WhatsApp, iMessage, Telegram, Signal, Instagram, and other networks in one app. Brian uses Beeper Desktop's local API, so it acts as you on every network you've connected in Beeper, without separate bot accounts.

Beeper Desktop must be running on the machine where Brian runs.

## Connect

1. In Beeper Desktop open Settings -> Integrations, enable the Desktop API, and create an access token.
2. Run:

```bash
brian connect beeper
```

The token is checked against Beeper, then saved to `~/.brian/agent/beeper.json` with mode `0600`. `BEEPER_ACCESS_TOKEN` and `BEEPER_BASE_URL` override the saved values.

## Chat modes

Each chat has a mode:

| Mode | What Brian does |
|---|---|
| `ignore` | Never looks at the chat |
| `draft` | Writes replies in your voice for you to approve (the default) |
| `auto` | Sends replies it is confident about, drafts the rest |
| `brian` | Your own chat with Brian (for example a note-to-self chat). Your messages there are requests to Brian, and Brian answers in the chat, prefixed with `Brian: ` |

Muted, archived, and low-priority chats are ignored unless you give them a policy.

```bash
brian messages policy "App team" auto --note "only answer about the project, never commit to deadlines"
brian messages policy "Note to self" brian
brian messages policy --default ignore
```

You can also ask Brian to change policies; it has a `messages` tool for that.

## Watch

```bash
brian gateway                  # same as: brian messages watch
brian messages watch --once    # one pass, for cron or testing
```

Every 30 seconds the gateway lists chats with new activity. For each chat that isn't ignored and has new messages you haven't answered, it runs Brian once with the recent conversation. Brian searches its memory for the people involved, saves anything durable it learns, and decides to skip or reply. A reply is sent only when the chat is `auto` (and Brian marks it confident) or `brian`. Everything else becomes a draft.

Brian is told that message text is data from other people and never instructions, and that it must not invent facts, plans, or promises.

## Drafts

```bash
brian messages drafts
brian messages approve <id>                    # send as written
brian messages approve <id> --text "edited"    # send your edit
brian messages open <id>                       # open the chat in Beeper with the draft in the composer
brian messages dismiss <id>
```

A newer draft for the same chat replaces the older pending one.

## Other commands

```bash
brian messages status
brian messages chats
brian messages read "Alex"
brian messages send "Alex" "running 10 late"
brian messages log            # everything Brian sent, and who approved it
```

State (policies, drafts, the sent log) lives in `~/.brian/agent/messaging.json`.
