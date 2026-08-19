// Shoot the documentation screenshots against a running td-gui.
//
//   node docs/screenshots/shoot.mjs http://127.0.0.1:7777 docs/images
//
// Drives a headless Chromium over the DevTools protocol. It is headless and
// CDP-driven rather than a real browser window because the images have a fixed
// geometry — 1400 px wide, dark theme, each one clipped to a named region of
// the page — and a window manager will not honour a requested window size.
//
// Requires chromium on PATH and node 22+ (for the global WebSocket).
//
// See README.md next to this file for the whole procedure.

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:7777').replace(/\/$/, '')
const OUT = process.argv[3] ?? 'docs/images'

const WIDTH = 1400
const HEIGHT = 1600 // tall enough that nothing we clip is below the fold

// --- CDP plumbing ------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
	const profile = await mkdtemp(join(tmpdir(), 'td-gui-shoot-'))
	const chrome = spawn(
		'chromium',
		[
			'--headless=new',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`,
			`--window-size=${WIDTH},${HEIGHT}`,
			'--hide-scrollbars',
			'--force-color-profile=srgb',
			'--disable-lcd-text', // keeps glyph edges neutral instead of fringed
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank',
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] },
	)

	// Chromium prints the websocket URL on stderr once it is listening.
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = ''
		const timer = setTimeout(() => reject(new Error('chromium did not report a debugging url')), 20000)
		chrome.stderr.on('data', (d) => {
			buf += d
			const m = buf.match(/ws:\/\/\S+/)
			if (m) {
				clearTimeout(timer)
				resolve(m[0])
			}
		})
		chrome.on('exit', (code) => reject(new Error(`chromium exited with ${code}`)))
	})

	const ws = new WebSocket(wsUrl)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', reject, { once: true })
	})

	let nextId = 1
	const pending = new Map()
	let sessionId = null

	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data)
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id)
			pending.delete(msg.id)
			msg.error ? reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? null)})`)) : resolve(msg.result)
		}
	})

	const raw = (method, params = {}, extra = {}) =>
		new Promise((resolve, reject) => {
			const id = nextId++
			pending.set(id, { resolve, reject })
			ws.send(JSON.stringify({ id, method, params, ...extra }))
		})

	// Attach to a page target and talk to it via a flattened session.
	const { targetInfos } = await raw('Target.getTargets')
	const page = targetInfos.find((t) => t.type === 'page')
	;({ sessionId } = await raw('Target.attachToTarget', { targetId: page.targetId, flatten: true }))

	const send = (method, params) => raw(method, params, { sessionId })

	await send('Page.enable')
	await send('Runtime.enable')
	await send('Emulation.setDeviceMetricsOverride', {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	})

	const close = async () => {
		ws.close()
		// Wait for the process to go away before removing its profile, otherwise
		// chromium writes into the directory while rm is walking it and rm fails
		// with ENOTEMPTY.
		const exited = new Promise((resolve) => chrome.once('exit', resolve))
		chrome.kill()
		await Promise.race([exited, sleep(5000)])
		await rm(profile, { recursive: true, force: true }).catch(() => {})
	}

	return { send, close }
}

// --- page helpers ------------------------------------------------------------

function makeApi(send) {
	async function evaluate(expression) {
		const { result, exceptionDetails } = await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		})
		if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
		return result.value
	}

	async function goto(path) {
		await send('Page.navigate', { url: BASE + path })
		// The bundle resolves the theme before first paint, so the preference has
		// to be in localStorage before the app boots. Setting it after a navigate
		// and reloading once is the reliable order: the origin has no storage
		// until something from it has loaded.
		await settled()
		const themed = await evaluate(`localStorage.getItem('td-gui.theme') === 'dark'`)
		if (!themed) {
			await evaluate(`localStorage.setItem('td-gui.theme', 'dark')`)
			await send('Page.reload')
			await settled()
		}
	}

	// The app has no load event we can trust — data arrives after hydration — so
	// wait for the DOM to stop changing.
	async function settled(quietMs = 350, timeoutMs = 10000) {
		const started = Date.now()
		let last = ''
		let stableSince = 0
		while (Date.now() - started < timeoutMs) {
			await sleep(100)
			let now
			try {
				now = await evaluate(`document.body.innerHTML.length + ':' + document.readyState`)
			} catch {
				continue // navigation in flight
			}
			if (now === last) {
				if (!stableSince) stableSince = Date.now()
				if (Date.now() - stableSince >= quietMs) return
			} else {
				last = now
				stableSince = 0
			}
		}
	}

	// Click the first button or link whose trimmed text equals `text`.
	async function click(text) {
		const found = await evaluate(`(() => {
			const el = [...document.querySelectorAll('button, a')]
				.find(e => e.textContent.trim() === ${JSON.stringify(text)});
			if (!el) return false;
			el.click();
			return true;
		})()`)
		if (!found) throw new Error(`no clickable element labelled "${text}"`)
		await settled()
	}

	// Type into React-controlled fields. Assigning `.value` directly is invisible
	// to React, which tracks the previous value on the DOM node — so this goes
	// through the native setter and then fires the event React is listening for.
	// `fields` maps element id to value; a select also needs a change event.
	async function fill(fields) {
		await evaluate(`(() => {
			const set = (el, value) => {
				const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
					: el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
					: HTMLInputElement.prototype;
				Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
				el.dispatchEvent(new Event('input', {bubbles: true}));
				el.dispatchEvent(new Event('change', {bubbles: true}));
			};
			for (const [id, value] of Object.entries(${JSON.stringify(fields)})) {
				const el = document.getElementById(id);
				if (!el) throw new Error('no field #' + id);
				set(el, value);
			}
		})()`)
		await settled()
	}

	// Accept the first suggestion of an open combobox, which closes its listbox.
	async function pickFirstOption() {
		const found = await evaluate(`(() => {
			const o = document.querySelector('[role=option]');
			if (!o) return false;
			o.click();
			return true;
		})()`)
		if (!found) throw new Error('no combobox option to pick')
		await settled()
	}

	// Where the rendered content actually ends. The page wrapper is min-h-screen,
	// so measuring it would append the unused rest of the viewport as dead space.
	const CONTENT_BOTTOM = `Math.max(...[...document.querySelectorAll('main *')]
		.map(e => e.getBoundingClientRect().bottom + window.scrollY))`

	// Full page width, from the top of the page down to `endExpr` — its bottom
	// edge by default, its top edge when the shot should stop before a section.
	// With no endExpr it runs to the end of the content.
	async function pageClip({ endExpr = null, endEdge = 'bottom', pad = 16 } = {}) {
		const bottom = await evaluate(
			endExpr
				? `(() => {
						const el = ${endExpr};
						if (!el) return null;
						const r = el.getBoundingClientRect();
						return (${endEdge === 'top' ? 'r.top' : 'r.bottom'}) + window.scrollY;
					})()`
				: CONTENT_BOTTOM,
		)
		if (bottom == null) throw new Error(`clip anchor not found: ${endExpr}`)
		return { x: 0, y: 0, width: WIDTH, height: Math.round(bottom + pad), scale: 1 }
	}

	// Full page width, spanning from the top of one element to the bottom of
	// another. Both must be in the same column, or the height comes out negative.
	async function regionClip(startExpr, endExpr, { pad = 14 } = {}) {
		const box = await evaluate(`(() => {
			const a = ${startExpr}, b = ${endExpr};
			if (!a || !b) return null;
			const sy = window.scrollY;
			return {top: a.getBoundingClientRect().top + sy, bottom: b.getBoundingClientRect().bottom + sy};
		})()`)
		if (!box) throw new Error(`region anchors not found: ${startExpr} .. ${endExpr}`)
		const height = Math.round(box.bottom - box.top + pad * 2)
		if (height <= 0) throw new Error(`region has no height: ${startExpr} .. ${endExpr}`)
		return { x: 0, y: Math.max(0, Math.round(box.top - pad)), width: WIDTH, height, scale: 1 }
	}

	async function shoot(name, clip) {
		const { data } = await send('Page.captureScreenshot', {
			format: 'png',
			clip,
			captureBeyondViewport: true,
			fromSurface: true,
		})
		const path = join(OUT, name + '.png')
		await writeFile(path, Buffer.from(data, 'base64'))
		console.log(`${name}  ${clip.width}x${clip.height}`)
		return path
	}

	return { evaluate, goto, settled, click, fill, pickFirstOption, pageClip, regionClip, shoot }
}

// --- the shots ---------------------------------------------------------------

// Selectors are expressed as text lookups rather than class names, because the
// classes are Tailwind utilities and change with any styling edit.
// A due date a little way out, so the create-form shot never shows a date in the
// past however long from now it is taken.
function dueDate(daysAhead = 12) {
	const d = new Date(Date.now() + daysAhead * 86400_000)
	return d.toISOString().slice(0, 10)
}

const heading = (tag, text) =>
	`[...document.querySelectorAll(${JSON.stringify(tag)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}))`
const section = (text) => `(${heading('h2', text)})?.closest('section') ?? (${heading('h2', text)})?.parentElement`

async function main() {
	const { send, close } = await launch()
	const p = makeApi(send)

	try {
		// Which issue is the hero, and which board has positioned cards, is read
		// off the running instance rather than hardcoded: the seed script produces
		// fresh ids on every run.
		await p.goto('/')
		const issues = await p.evaluate(
			`fetch('/v1/issues?limit=1000').then(r => r.json()).then(d => d.data.issues.map(i => ({id: i.id, title: i.title, status: i.status})))`,
		)
		const byTitle = (needle) => {
			const hit = issues.find((i) => i.title.includes(needle))
			if (!hit) throw new Error(`no seeded issue matching "${needle}" — is this the demo project?`)
			return hit.id
		}
		const hero = byTitle('Thumbnail generation blocks')
		const epic = byTitle('Harden the upload pipeline')

		const boards = await p.evaluate(
			`fetch('/v1/boards').then(r => r.json()).then(d => d.data.boards.map(b => ({id: b.id, name: b.name})))`,
		)
		const board = boards.find((b) => b.name === 'Current work')
		if (!board) throw new Error('no "Current work" board — is this the demo project?')

		// 1. The issue list, header included.
		await p.goto('/')
		await p.shoot('issue-list', await p.pageClip())

		// 2. The detail page, down to where the activity shot picks up.
		await p.goto(`/issues/${hero}`)
		await p.shoot('issue-detail', await p.pageClip({ endExpr: section('Activity'), endEdge: 'top', pad: 0 }))

		// 3. Activity and the comment box, further down the same page. Anchored on
		// Comments rather than on Metadata: Metadata is in the sidebar and starts
		// near the top of the page, which would ask for a negative height.
		await p.shoot('issue-activity', await p.regionClip(section('Activity'), section('Comments')))

		// 4. The approve form, with its attribution radio group. No padding at all:
		// the sidebar's first card begins one pixel under the form, so any pad drags
		// a slice of its rounded border into the shot.
		await p.click('Approve')
		await p.shoot(
			'issue-review',
			await p.pageClip({ endExpr: `document.querySelector('input[type=radio]')?.closest('form')`, pad: 0 }),
		)

		// 5. The editor, opened in place on the detail page.
		await p.goto(`/issues/${hero}`)
		await p.click('Edit')
		await p.shoot('issue-edit', await p.pageClip())

		// 6. The create form, every field td accepts at creation. Filled in rather
		// than blank: an empty form shows the fields exist but not what any of them
		// takes, and the parent field is only meaningful with an id in it. Nothing
		// is submitted — the form is populated and photographed, not sent.
		await p.goto('/new')
		await p.fill({
			'new-title': 'Warn before an import that would exceed the disk',
			'new-description':
				'An import of 40 GB onto a volume with 30 GB free fails halfway and leaves the library holding photos whose originals were never written.\n\nCheck the free space against the size of the selection first, and say so before anything is copied.',
			'new-acceptance':
				'- The import dialog refuses a selection larger than the free space, and names both numbers\n- A partial import is rolled back rather than left half-written\n- The check is skipped, with a warning, where the free space cannot be determined',
			'new-type': 'feature',
			'new-priority': 'P2',
			'new-points': '3',
			'new-sprint': '2026-W35',
			'new-parent': epic,
			'new-due': dueDate(),
			'label-entry': 'uploads',
		})
		// Turns the typed text into a chip, which is the part of the labels field
		// worth showing.
		await p.click('Add label')
		// The parent combobox opens its suggestion list over the minor checkbox
		// below it, so leaving it open would drop a documented field out of the
		// shot. Accepting the suggestion closes the list and keeps the parent set.
		await p.pickFirstOption()
		await p.shoot('issue-new', await p.pageClip())

		// 7. The board list, builtin board included.
		await p.goto('/boards')
		await p.shoot('board-list', await p.pageClip())

		// 8. The backlog view: a pinned block and a query-ordered one.
		await p.goto(`/boards/${board.id}?view=backlog`)
		await p.shoot('board-backlog', await p.pageClip())

		// 9. Swimlanes.
		await p.goto(`/boards/${board.id}?view=swimlanes`)
		await p.shoot('board-swimlanes', await p.pageClip())

		// 10. The About page, reached from the icon in the header. Every value on
		// it comes from the process that is being photographed, so the td path is
		// whichever binary this run was given — see README.md for why that must not
		// be one under a home directory.
		await p.goto('/about')
		await p.shoot('about', await p.pageClip())

		// No post-processing step: chromium's own PNG encoding came out smaller than
		// re-encoding it through ImageMagick, so these files are final.
		console.log(`\nWritten to ${OUT}.`)
		console.log(`hero=${hero} epic=${epic} board=${board.id}`)
	} finally {
		await close()
	}
}

await main()
