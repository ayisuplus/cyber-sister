const TOOL_LABELS = {
  update_plan: '整理任务步骤', web_search: '搜索资料', create_artifact: '准备交付文件',
  read_artifact: '读取文件', list_artifacts: '查找会话文件', calc_convert: '计算并核对',
  read_web: '阅读网页正文', execute_python: '运行代码并核对输出',
  browser_open: '打开网页', browser_act: '操作页面', browser_snapshot: '核对页面与截图',
  generate_image: '生成图片并等待云端结果', get_generated_image: '查询并取回生成图片',
  add_task: '记一件事', list_tasks: '看日历上的事', update_task: '改一件事', delete_task: '删一件事',
}
const STEP_LABELS = { pending: '待处理', in_progress: '进行中', completed: '已完成' }

export default function WorkProgress({ progress = [], toolRuns = [] }) {
  const latest = progress.at(-1)
  // 步骤清单只在真的多步办事时出现；一步的「计划」不值得一张清单
  const found = [...toolRuns, ...progress].reverse().find((run) => Array.isArray(run.plan))?.plan
  const plan = found?.length >= 2 ? found : null
  if (!latest && !plan) return null
  return (
    <div className="my-2 rounded-xl border border-border-hairline bg-surface-input px-3 py-2 text-xs text-text-secondary">
      {latest && <p role="status">{latest.status === 'running' ? `${TOOL_LABELS[latest.tool] || '处理任务'}…` : latest.summary || (latest.status === 'failed' ? '步骤执行失败' : '步骤完成')}</p>}
      {plan && <ol aria-label="任务步骤" className="mt-2 space-y-1.5">
        {plan.map((step, index) => <li key={index} className="flex gap-2">
          <span className="shrink-0">{STEP_LABELS[step.status] || '待处理'}</span><span>{step.title}</span>
        </li>)}
      </ol>}
    </div>
  )
}
