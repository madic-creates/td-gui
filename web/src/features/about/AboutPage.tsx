import { useAbout } from '../../api/queries'
import { unboundMessage } from '../../api/client'
import CopyButton from '../../components/CopyButton'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import type { About } from '../../api/types'

/**
 * `owned` is a boolean on the wire and a sentence here. "true" would tell a
 * reader filing a bug report nothing, and which of the two it is decides
 * whether killing td-gui also stops the backend.
 */
function backendState(about: About): string {
  return about.backend.owned
    ? `${about.backend.url} — started by td-gui`
    : `${about.backend.url} — existing instance`
}

/**
 * Everything a maintainer asks for, already formatted. The alternative is the
 * reporter transcribing six fields by hand, which is where the version they
 * actually run stops matching the version they report.
 */
function diagnostics(about: About): string {
  return [
    '| | |',
    '| --- | --- |',
    `| td-gui | ${about.td_gui} |`,
    `| td | ${about.td} |`,
    `| td path | ${about.td_path} |`,
    `| Go | ${about.go} |`,
    `| Platform | ${about.platform} |`,
    `| Project | ${about.project} |`,
    `| Backend | ${about.backend.owned ? 'started by td-gui' : 'existing instance'} |`,
  ].join('\n')
}

/** One label/value pair. `mono` is for the values that are paths or ids. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2">
      <dt className="w-32 shrink-0 text-[11px] uppercase tracking-widest text-ink-muted">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1.5 break-all">{children}</dd>
    </div>
  )
}

export default function AboutPage() {
  const { data, error, isPending } = useAbout()

  if (isPending) return <SkeletonRows label="Loading about" />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  return (
    <div className="p-4">
      <h1 className="mb-3 text-[11px] uppercase tracking-widest text-ink-muted">About</h1>

      <dl className="max-w-3xl">
        <Row label="Project">
          <span className="font-mono">{data.project}</span>
          <CopyButton value={data.project} label="Copy project path" />
        </Row>
        <Row label="td-gui"><span className="font-mono">{data.td_gui}</span></Row>
        <Row label="td"><span className="font-mono">{data.td}</span></Row>
        <Row label="td path"><span className="font-mono">{data.td_path}</span></Row>
        <Row label="Go"><span className="font-mono">{data.go}</span></Row>
        <Row label="Platform"><span className="font-mono">{data.platform}</span></Row>
        <Row label="Backend"><span className="font-mono">{backendState(data)}</span></Row>
        <Row label="Source">
          {/* Opens the public repository from a page served on loopback: the
              new tab must not keep a handle on this one. */}
          <a
            href={data.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            {data.source.replace(/^https?:\/\//, '')}
          </a>
        </Row>
        <Row label="License">{data.license}</Row>
      </dl>

      <div className="mt-4">
        <CopyButton
          value={diagnostics(data)}
          label="Copy diagnostics"
          text="Copy diagnostics"
        />
      </div>
    </div>
  )
}
