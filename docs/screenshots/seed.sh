#!/usr/bin/env bash
#
# Seed a throwaway td project for the documentation screenshots.
#
#   docs/screenshots/seed.sh /tmp/shoebox
#
# The project is "Shoebox", an invented self-hosted photo library. Nothing here
# describes td-gui, so a reader cannot mistake the screenshots for this repo's
# own backlog, and nothing in it can go stale.
#
# Everything goes through the td CLI, never through issues.db, for the same
# reason td-gui goes through `td serve`: td owns its migrations, action log and
# review policy. That also makes the session attribution real — td refuses to
# let a session approve its own work, so `td session --new` marks the seams
# where a different context takes over.
#
# See README.md next to this file for what to do with the result.

set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "usage: $(basename "$0") <target-directory>" >&2
	exit 64
fi

DIR=$1

if [[ -e $DIR && ! -d $DIR ]]; then
	echo "$DIR exists and is not a directory" >&2
	exit 1
fi

# This script deletes its target, so it will only delete a directory it can see
# it created itself. Anything else — including an empty directory someone made
# by hand, and any real td project — is refused rather than guessed at.
STAMP=.td-gui-screenshot-seed

if [[ -d $DIR ]]; then
	if [[ ! -f $DIR/$STAMP ]]; then
		echo "$DIR exists and was not created by this script ($STAMP missing); refusing" >&2
		exit 1
	fi
	rm -rf "$DIR"
fi

mkdir -p "$DIR"
cd "$DIR"
touch "$STAMP"

command -v td >/dev/null || { echo "td is not on PATH" >&2; exit 1; }

# td records the branch an issue was created on, so the demo project is a git
# repo. The identity is set locally because this must work on a machine with no
# global git config, and it never leaves the throwaway directory.
git init --quiet --initial-branch=main
git config user.name "Shoebox"
git config user.email "shoebox@example.invalid"
git config commit.gpgsign false
# Without this every `td start` warns about a dirty worktree, because .todos is
# the only thing in it.
printf '.todos/\n%s\n' "$STAMP" >.gitignore
git add .gitignore
git commit --quiet -m "Initial commit"
td init >/dev/null

# --- helpers -----------------------------------------------------------------

# mk <title> [flags...] -> prints the new issue id
mk() {
	local title=$1
	shift
	td create "$title" "$@" | sed -n 's/^CREATED \(td-[0-9a-f]*\).*/\1/p'
}

# Mark the seam where another context picks the work up. Every handoff, review
# and approval below is attributed to whichever session is current here.
session() { td session --new >/dev/null; }

q() { "$@" >/dev/null; }

# --- epics -------------------------------------------------------------------

sharing=$(mk "Album sharing links with expiring tokens" \
	--type epic --priority P2 --labels sharing \
	--description "Let an album be handed to someone without an account: a signed link that stops working on a date the owner picks, and can be revoked before then.

Covers the token format, the dialog that creates a link, and revocation. Public album pages and per-photo links are out of scope.")

uploads=$(mk "Harden the upload pipeline" \
	--type epic --priority P1 --labels uploads,backend \
	--description "The upload path was written for a single user on a laptop and has not been touched since. It does thumbnailing inline, keeps originals on the local disk, and gives the browser no progress to show.

The three tasks under this epic are the order we intend to fix that in.")

# --- the closed dependency and the blocked one it feeds ----------------------

queue=$(mk "Add a job queue table" \
	--type task --priority P2 --points 3 --labels backend \
	--description "A single jobs table with a claim-by-update pattern. No broker, no extra service to run — this is a self-hosted install and every dependency is someone's evening.")
q td start "$queue"
q td log "$queue" --decision "Claim-by-update on a status column rather than SKIP LOCKED, so this still works on the SQLite build."
q td review "$queue"
session
q td approve "$queue" --reason "Claim is atomic and the two-worker race test covers it."
session

objstore=$(mk "Move uploads onto object storage" \
	--type feature --priority P1 --points 8 --labels uploads,backend --parent "$uploads" \
	--description "Originals live on the local disk, which is why there is no way to run a second instance and no way to back the library up without stopping it.

Write through an interface with a filesystem implementation and an S3-compatible one, so a single-machine install keeps working exactly as it does now.")

# --- the hero issue: the one docs/issues.md shows in detail -------------------

session

hero=$(mk "Thumbnail generation blocks the upload response" \
	--type bug --priority P1 --points 5 --labels uploads,performance,backend \
	--parent "$uploads" --due +9d \
	--description "Uploading a photo does not return until every thumbnail size has been written. On a phone camera JPEG that is around 400 ms; on a 60 MP raw file it is eleven seconds, and the browser gives up first.

The upload itself succeeded in those cases, which is the worst part: the file is in the library, the client shows a failure, and the retry produces a duplicate that duplicate detection then has to catch.

Thumbnailing belongs on the job queue. The response should return as soon as the original is stored and the row is written." \
	--acceptance "- POST /v1/photos returns as soon as the original is stored, measured under 300 ms for a 60 MP file
- Thumbnails are produced by a queued job, and the photo row records that they are pending
- The grid renders a placeholder for a photo whose thumbnails are not ready yet, and swaps it in without a reload
- A failed thumbnail job is retried three times and then surfaced on the photo, not swallowed
- No duplicate rows are created by a client that retries a request it believed had failed")

q td update "$hero" --sprint "2026-W34"
q td dep add "$hero" "$queue"
q td dep add "$hero" "$objstore"

progress=$(mk "Show upload progress per file" \
	--type feature --priority P2 --points 5 --labels uploads,frontend --parent "$uploads" \
	--description "A per-file progress bar and a count of what is still going, instead of the single spinner that covers the whole batch. Needs the upload response to return before thumbnailing, otherwise the bar sits at 100% for eleven seconds.")

q td dep add "$progress" "$hero"

# Raised at triage, before anyone picks the issue up, so the reply below comes
# from a different session and the comment thread reads as two voices.
q td comment "$hero" "The duplicate-from-retry part is worth splitting out. It is the same bug whenever a request is slow enough to time out, not only on upload."

session
q td start "$hero"
q td log "$hero" "Reproduced on a 61 MP raw: 11.4 s response time, 10.9 s of it in the thumbnailer."
q td log "$hero" --decision "Thumbnails go on the job queue from td-queue rather than a goroutine per upload. A goroutine loses the work on restart, and a restart mid-import is exactly when this hurts."
q td log "$hero" --blocker "Blocked for a day on the object storage interface landing — the job needs to read the original back, and reading it from the local path would have to be undone immediately."
q td log "$hero" "Queue job and retry handling done. Grid placeholder still renders the broken-image icon rather than the placeholder."

q td comment "$hero" "Agreed, but not before this lands — the fix here removes the timeout that causes it, so a separate issue would be written against behaviour that is about to change."

q td handoff "$hero" \
	--done "Thumbnailing moved onto the job queue, with three retries and a terminal failure recorded on the photo" \
	--done "POST /v1/photos returns after the original is stored; 240 ms on the 61 MP test file" \
	--done "photos.thumbnails_pending column and the migration for it" \
	--remaining "Grid placeholder for pending thumbnails — the API reports the state, the frontend ignores it" \
	--remaining "Backfill for the rows written while the old path was live" \
	--decision "Job queue rather than a goroutine per upload: work has to survive a restart during an import" \
	--decision "Retry three times, then record the failure on the photo. Silent failure was how this went unnoticed for so long" \
	--uncertain "Whether the placeholder should show a spinner or nothing. A spinner on 400 photos at once looked worse than an empty tile in the mockup"

q td review "$hero"

# A different context reviews it, sends it back, and the change is reworked and
# resubmitted — which is what leaves a superseded review on the issue.
session
# The changes_requested review is recorded explicitly: `td reject` moves the
# issue and writes a log entry but leaves no review record, and without two
# records there is nothing for the review panel to mark as superseded.
q td approve "$hero" --record-only --decision changes_requested \
	--reason "Retry count is right but the backoff is fixed at one second, so three retries of a job that fails on a bad file hammer the same file three times in three seconds. Needs an exponential delay."
q td reject "$hero" --reason "Sending back for the backoff. The rest of the change reads fine."

session
q td start "$hero"
q td log "$hero" "Backoff is now 2^n seconds with jitter."
q td review "$hero"

session
q td approve "$hero" --record-only --reason "Backoff addressed. Approving the change itself; leaving it open because the grid placeholder is part of the same acceptance criteria and is not done."

# --- the rest of the sharing epic -------------------------------------------

session

# All three children are created before any of them completes. td cascades a
# parent to closed once every child is complete, so closing the first task
# while it was the epic's only child would close the epic with two tasks still
# unwritten.
tokens=$(mk "Generate signed share tokens" \
	--type task --priority P2 --points 3 --labels sharing,backend --parent "$sharing" \
	--description "An HMAC over album id and expiry, so validating a link is a comparison and needs no table lookup. Revocation does need state, and that is the next task, not this one.")

dialog=$(mk "Share dialog with expiry picker" \
	--type feature --priority P2 --points 5 --labels sharing,frontend --parent "$sharing" \
	--description "A dialog on the album view: a copyable link, an expiry the owner picks, and the links that already exist with the ability to revoke one.

Presets of 24 hours, 7 days and 30 days, plus a date picker, because every real use of this is one of those three.")

revoke=$(mk "Revoke a share link from the album view" \
	--type task --priority P3 --points 2 --labels sharing --parent "$sharing" \
	--description "A revoked-tokens table, checked on validation. Small, but it is the reason token validation cannot stay a pure comparison forever.")
q td dep add "$revoke" "$tokens"

q td start "$tokens"
q td review "$tokens"
session
q td approve "$tokens" --reason "Token format and the constant-time comparison both check out."

session
q td start "$dialog"
q td log "$dialog" "Dialog and the copy button are done. The expiry presets need the revocation list to know what to render for an already-expired link."

# --- everything else ---------------------------------------------------------

session

dupes=$(mk "Duplicate detection matches unrelated photos after a re-index" \
	--type bug --priority P0 --labels search,backend \
	--description "After a full re-index, the perceptual hash column holds the hash of the *previous* row for anything the indexer processed in its second batch onward — an off-by-one over the batch cursor.

The effect a user sees is that unrelated photos are offered as duplicates of each other, and accepting the suggestion deletes a photo they wanted. Two reports so far, both recoverable from the trash, and that window is 30 days." \
	--acceptance "- The batch cursor is covered by a test that runs more than one batch
- A repair command recomputes hashes for a library indexed by the broken version
- The duplicate suggestion UI is disabled while a re-index is running")

heic=$(mk "Import stalls on HEIC files larger than 40 MB" \
	--type bug --priority P1 --points 3 --labels uploads,backend \
	--description "The decoder is called with the whole file in memory and the import worker has a 512 MB limit, so a burst of large HEIC files from a recent iPhone stalls the worker until it is restarted by hand.")
q td start "$heic"
q td log "$heic" "Streaming the decode brings the peak from 380 MB to 44 MB per file. Still need to cap concurrent decodes — four at once is back over the limit."

exif=$(mk "EXIF timezone is read as UTC for cameras without an offset" \
	--type bug --priority P2 --points 2 --labels backend \
	--description "Cameras that write DateTimeOriginal without OffsetTimeOriginal get read as UTC, so a photo taken at 14:00 in Berlin sorts as though it were taken at 16:00 and lands on the wrong day in the timeline.

Fall back to the library's configured timezone, and where the photo has coordinates, to the timezone those coordinates are in." \
	--acceptance "- A photo with coordinates and no offset is dated in the timezone of its coordinates
- A photo with neither is dated in the library timezone
- Existing rows are corrected by a repair command, not silently on read")
q td start "$exif"
q td handoff "$exif" \
	--done "Coordinate-to-timezone lookup, with the boundary shapefile embedded rather than an API call" \
	--remaining "The repair command, and deciding whether it runs automatically on upgrade" \
	--uncertain "What to do about a photo whose coordinates are in a timezone that has since changed its offset rules"
q td review "$exif"

deleted=$(mk "Search returns deleted photos for two minutes after deletion" \
	--type bug --priority P3 --points 1 --labels search \
	--description "The search index is updated on a two-minute tick, so a photo deleted just before a tick is still a hit until the next one — and clicking the hit is a 404.")
q td start "$deleted"
q td review "$deleted"

q mk "Face grouping suggestions in the people view" \
	--type feature --priority P2 --points 13 --labels ml,frontend --defer +5d \
	--description "Cluster face embeddings and offer the clusters as \"is this the same person?\", rather than asking someone to tag four thousand photos by hand.

Deferred until the upload pipeline work lands: it wants the job queue, and running the embedding pass on the current inline path would make uploads slower than they already are." \
	--acceptance "- Clustering runs as a queued job over photos that have embeddings
- The people view offers each cluster as a single confirm-or-split decision
- Confirming a cluster names every face in it; splitting returns them to unnamed
- Nothing is named without a confirmation"

q mk "Album cover resets when the first photo is deleted" \
	--type bug --priority P2 --points 1 --labels frontend \
	--description "The cover is stored as a position rather than a photo id, so deleting the photo in front of it silently moves the cover to whatever is now first."

q mk "Keyboard shortcuts for the lightbox" \
	--type feature --priority P3 --points 2 --labels frontend,a11y --minor \
	--description "Arrow keys to move, Escape to close, and a visible focus ring on the controls. Currently the lightbox is reachable only with a mouse, which also means it is unreachable with a screen reader."

backfill=$(mk "Backfill missing thumbnails for pre-2024 uploads" \
	--type task --priority P3 --points 3 --labels uploads \
	--description "Roughly 12k rows from before the thumbnailer wrote a 2048 px size. They render the 512 px version scaled up, which on a 4K display looks like a bug in the photo rather than in the library.")
q td dep add "$backfill" "$hero"

q mk "Document the backup and restore procedure" \
	--type task --priority P3 --labels docs --minor \
	--description "What to copy, in what order, and how to verify the copy — including the part where the database and the originals have to be consistent with each other."

vips=$(mk "Upgrade the image pipeline to libvips 8.16" \
	--type chore --priority P2 --points 3 --labels backend \
	--description "8.16 fixes the JPEG XL decode we work around, and the workaround is the reason the thumbnailer holds the whole file in memory.")

legacy=$(mk "Drop the legacy /v1/photos response shape" \
	--type chore --priority P3 --points 2 --labels backend \
	--description "The pre-1.0 shape has been served alongside the current one behind an Accept header for four releases. Nothing in the frontend asks for it.")
q td start "$legacy"
q td review "$legacy"
session
q td approve "$legacy" --reason "Checked the frontend and the two published clients; none send the old Accept header."

session
ci=$(mk "Pin the CI runner image to a digest" \
	--type chore --priority P3 --points 1 --labels ci --minor \
	--description "The runner tracks a moving tag, so a build that passed yesterday and fails today tells us nothing about our own change.")
q td start "$ci"
q td review "$ci"
q td approve "$ci" --self-review --reason "One-line change to a workflow file, verified by the build it runs in."

# --- blocked -----------------------------------------------------------------

q td block "$objstore" --reason "Waiting on the storage decision — the S3 credentials story for a single-machine install is unresolved, and building the interface around a guess would mean building it twice."
q td block "$vips" --reason "8.16 is not in the base image yet. Held until the runner image is pinned, so the upgrade and the pin do not fight."

# --- boards ------------------------------------------------------------------

# "Current work" is the board both board screenshots are taken from, so its
# query is deliberately wide: a narrow one leaves the backlog view's
# query-ordered block with two cards in it, which shows nothing about the
# boundary that block exists to draw.
q td board create "Current work" --query "priority <= P2 AND status != closed"
q td board create "Open bugs" --query "type = bug AND status != closed"

# Three cards get an explicit position, so the backlog view shows both a
# pinned block and the query-ordered remainder.
q td board move "Current work" "$dupes" 1
q td board move "Current work" "$hero" 2
q td board move "Current work" "$heic" 3

# --- done --------------------------------------------------------------------

td session --new >/dev/null

echo
echo "Seeded $DIR"
td list 2>/dev/null | tail -n +1 | head -0 || true
printf 'hero issue (the one docs/issues.md shows in detail): %s\n' "$hero"
printf 'epic with children:                                  %s\n' "$uploads"
echo
echo "Next: td-gui --work-dir $DIR --port 7777 --no-open"
