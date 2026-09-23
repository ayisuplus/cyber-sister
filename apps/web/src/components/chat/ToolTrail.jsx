// 她这一轮替你办了什么：一件办成的事只写一行轻声的小字；两件以上或有没办成的，收成一行摘要，点开看每一件。
// 没办成的数目写在摘要里，不藏进折叠；每一件的读屏标签照旧是「已执行：…」「执行失败：…」。

function Run({ run }) {
  const waiting = run.pending === true
  return (
    <li aria-label={waiting ? `等你确认：${run.summary}` : run.dismissed ? `未执行：${run.summary}` : `${run.ok ? '已执行' : '执行失败'}：${run.summary}`}
      className={`flex gap-1 ${!run.ok ? 'text-danger' : waiting ? 'text-text-secondary' : 'text-text-muted'}`}>
      <span aria-hidden="true">{!run.ok ? '✗' : waiting ? '…' : run.dismissed ? '–' : '✓'}</span>
      <span>{waiting ? `等你确认：${run.summary}` : run.summary}</span>
    </li>
  )
}

function summaryOf(runs) {
  const waiting = runs.filter((run) => run.pending === true).length
  const dismissed = runs.filter((run) => run.dismissed === true).length
  const failed = runs.filter((run) => !run.ok).length
  const acted = runs.length - waiting - dismissed
  if (!failed) return `${acted ? `帮你办了 ${acted} 件事` : dismissed ? '你没让做' : '有事等你确认'}${waiting ? `，${waiting} 件等你确认` : ''}${dismissed && acted ? `，${dismissed} 件你没让做` : ''}`
  return failed === acted ? `${failed} 件事没办成` : `办了 ${acted} 件事，${failed} 件没办成`
}

/** @param {{ runs: Array<{ tool: string, ok: boolean, summary: string, pending?: boolean, dismissed?: boolean }> }} props */
export default function ToolTrail({ runs }) {
  if (!runs.length) return null
  if (runs.length === 1 && runs[0].ok && !runs[0].dismissed) {
    return <ul className="mt-1 text-[11px]"><Run run={runs[0]} /></ul>
  }
  const failed = runs.some((run) => !run.ok)
  return (
    <details className="mt-1 text-[11px]">
      <summary className={`min-h-6 cursor-pointer select-none ${failed ? 'text-danger' : 'text-text-muted'}`}>{summaryOf(runs)}</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {runs.map((run, index) => <Run key={`${run.tool}-${index}`} run={run} />)}
      </ul>
    </details>
  )
}
