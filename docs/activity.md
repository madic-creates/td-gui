# Activity

**Activity** in the header opens `/activity`: what has happened in the
project lately, and which agent sessions did it.

## Recent activity

The left column is td's own activity feed, the same one `td monitor` shows:
the most recent events across every session, newest first. Each entry names
the session that wrote it, says when, and shows td's message as td wrote it.

- An entry about an issue links to that issue.
- Some entries are about something else, such as a log line, a handoff or a
  linked file. Those show as text without a link.
- Log entries carry their kind as a tag: `progress`, `decision`, `blocker`.

td decides how many events the feed holds; td-gui shows all of them and
cannot load older ones.

## Agent sessions

The right column lists the sessions td has recorded, most recently active
first, with their id, branch and when they were last seen. The twenty most
recent show; **Show all** reveals the rest.

"Seen" is the last time a session wrote to td. It is not a liveness check: a
session seen a minute ago may have exited, and one seen last week may still
be running idle.

## Live updates

Both columns refresh by themselves whenever anything in the project changes,
like every other page. If one of them cannot be loaded, it shows td's error
and the other keeps working.
