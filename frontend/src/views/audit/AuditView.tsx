import { useCallback, useEffect, useMemo, useState } from 'react'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { isoWeekOf } from '@/api/settlement'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('audit')
const columns = [
  "日志编号",
  "操作类型",
  "操作对象",
  "操作详情",
  "操作来源",
  "执行时间",
  "影响行数",
  "回滚能力",
  "结算批次",
  "周次"
]
const actions = [
  "提交审核",
  "归档日志",
  "忽略日志"
]
const statuses = [
  "草稿",
  "待审核",
  "已归档",
  "已忽略"
]
const stats = [
  {
    "label": "审计日志总数",
    "value": 0
  },
  {
    "label": "已归档日志",
    "value": 0
  },
  {
    "label": "待审核日志",
    "value": 0
  }
]

export default function AuditView() {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const initialAudit = listEntries(meta.key, {})
  const [rows, setRows] = useState<EntryRow[]>(initialAudit.items)
  const [total, setTotal] = useState(initialAudit.total)
  const [errorMessage, setErrorMessage] = useState('')
  const filterFields = useMemo(() => ["日志编号", "操作类型", "周次"], [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '操作审计列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    reload()
  }

  const currentWeek = useMemo(() => isoWeekOf(new Date()), [])
  // 本周结算结果：只取结算动作产生的审计明细，其他业务日志不计入。
  const weekSettlementRows = useMemo(
    () => rows.filter((row) => String(row['周次'] ?? '') === currentWeek && String(row['操作类型'] ?? '') === '结算确认'),
    [rows, currentWeek],
  )

  return (
    <section className="page" data-module="audit">
      <header className="page-head">
        <div>
          <h2>操作审计管理</h2>
          <p className="page-desc">维护操作审计日志的输入、执行约束与结果记录，为操作审计提供可验证的数据工程流程。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('审计日志登记入口尚未接入审批流')}>
            登记审计日志
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出操作审计清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
        <article className="stat-card" data-testid="audit-week-stats">
          <span className="stat-label">本周结算明细（{currentWeek}）</span>
          <strong className="stat-value">{weekSettlementRows.length}</strong>
        </article>
      </div>

      <section className="panel" data-testid="audit-week-panel">
        <header className="panel-head">
          <h3>本周结算结果</h3>
          <span className="panel-hint">结算动作的审计明细按周归档，记录本周结算的资源汇总</span>
        </header>
        <table className="data-table compact">
          <thead>
            <tr>
              <th>日志编号</th>
              <th>结算周期</th>
              <th>结算批次</th>
              <th>操作来源</th>
              <th>执行时间</th>
              <th>操作详情</th>
            </tr>
          </thead>
          <tbody>
            {weekSettlementRows.map((row) => (
              <tr key={String(row.id)}>
                <td>{row['日志编号']}</td>
                <td>{row['结算周期']}</td>
                <td>{row['结算批次']}</td>
                <td>{row['操作来源']}</td>
                <td>{row['执行时间']}</td>
                <td>{row['操作详情']}</td>
              </tr>
            ))}
            {weekSettlementRows.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={6}>本周暂无结算结果</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 2}>暂无操作审计数据，可先登记审计日志</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条操作审计记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
