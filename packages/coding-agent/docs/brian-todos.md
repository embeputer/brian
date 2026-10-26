# Brian todos

The Brian `todo` tool stores ordered tasks in `todos.sqlite` under `BRIAN_DATA_DIR`, or under the user agent directory when `BRIAN_DATA_DIR` is unset. Each task list belongs to one core session ID and the original working directory recorded in its session header. Resuming with a working directory override keeps the same list. A new session starts with an empty list. Sessions without persistence keep their tasks in memory. The context hook reads that session's current list before model requests.

Every `todo` tool result carries the session's full list after the action in `details.todos`, in plan order. RPC clients can read it from the `tool_execution_end` event's `result.details`:

```json
{ "todos": [{ "id": 1, "text": "Write tests", "done": true }, { "id": 2, "text": "Ship", "done": false }] }
```

A failed action, such as toggling a missing ID, ends with `isError: true` and empty `details`; keep the last list you received.

Earlier versions kept one list in `todos.json`: `$BRIAN_DATA_DIR/todos.json` when `BRIAN_DATA_DIR` is set, which every project in that data directory shares, otherwise `.brian/todos.json` in the working directory. After the upgrade, each such file is imported once, into the first persistent session that starts with that file in reach and has no stored tasks yet. A session that already has tasks skips the import and leaves the file for a later session. The extension leaves the JSON file in place and records its migration in SQLite, so it cannot import again after a reset. The old file has no thread or session identifier; its original owner cannot be recovered automatically.
