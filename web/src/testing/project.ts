import { http, HttpResponse } from 'msw'
import type { Project } from '../api/types'

/**
 * GET /v1/project as td v0.66.0 answers it, with the bounds a fresh project
 * gets. Test-only, and shared because the header and both title fields read
 * it, so every suite that mounts one of them needs a handler.
 */
export const project: Project = {
  name: 'td-project',
  path: '/home/you/td-project',
  session_id: 'ses_a80e11',
  title_min_length: 15,
  title_max_length: 200,
  capabilities: ['issue_revisions', 'board_move'],
}

export const projectHandler = http.get('/v1/project', () =>
  HttpResponse.json({ ok: true, data: project }))

/** A failed read: td is there, but this one request did not get an answer. */
export const projectFailsHandler = http.get('/v1/project', () =>
  HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 }))
