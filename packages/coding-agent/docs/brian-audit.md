# Weekly audit

Brian records which skills and memory notes it reads or writes in `~/.brian/agent/usage.json`. The audit uses that record to keep skills and memory current.

```bash
brian audit --report          # what looks stale, untagged, duplicated, or missing
brian audit --report --json
brian audit                   # Brian reads the report and fixes things, then summarizes
brian audit --schedule        # weekly routine (default sunday 10am, --when to change)
brian audit --unschedule
```

The report lists:

- skills older than 30 days with no use in 30 days (Brian deletes one only if it is confident the skill will not be needed);
- notes with no tags or people;
- notes not changed or read in 180 days;
- people linked from notes who have no `People/` note;
- notes with the same name in several folders;
- empty folders.

A scheduled audit is a `task` routine. Like other routines, it runs while `brian routines daemon` is running. See [routines](brian-routines.md).
