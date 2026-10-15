import type { ActivityItem, Session } from '../../api/types'

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 'ses_aaaaaa',
    name: '',
    agent_type: 'claude-code_1',
    branch: 'main',
    last_activity: '2026-10-15T12:00:00Z',
    ...over,
  }
}

export function makeActivity(over: Partial<ActivityItem> = {}): ActivityItem {
  return {
    timestamp: '2026-10-15T12:00:00Z',
    session_id: 'ses_aaaaaa',
    type: 'action',
    action: 'start',
    log_type: '',
    message: 'started work',
    issue_id: 'td-000001',
    issue_title: 'An issue title',
    ...over,
  }
}
