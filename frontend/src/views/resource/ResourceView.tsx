import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  CALIBER,
  currentPeriod,
  isoWeekOf,
  listAuditByWeek,
  listPeriodOptions,
  listSettlementBatches,
  normalizePeriod,
  previewSettlement,
  registerMetering,
  settlePeriod,
  SETTLEMENT_ROLE_MESSAGE,
} from '@/api/settlement'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { Actor, EntryRow, MeteringJobType, SettlementBatch, SettlementPreview, SettlementResult } from '@/data/types'

const meta = moduleMeta('resource')
const columns = [
  '记录编号',
  '计算引擎',
  '作业名称',
  '作业类型',
  '作业编号',
  'CPU核秒',
  '内存GB秒',
  '存储占用GB',
  '扫描数据量',
  '计费周期',
  '补录标记',
  '原始计费周期',
]
const statuses = ['草稿', '待汇总', '已结算', '已归档']
const JOB_TYPES: MeteringJobType[] = ['流处理作业', '批量转换任务']

function emptyForm(): Record<string, string> {
  return {
    计算引擎: '计算引擎 A',
    作业名称: '',
    作业类型: '流处理作业',
    作业编号: '',
    CPU核秒: '',
    内存GB秒: '',
    存储占用GB: '',
    扫描数据量: '',
    计费周期: '2026-11',
  }
}

function readWorkspace(filters: Record<string, string>, period: string) {
  const payload = listEntries(meta.key, filters)
  return {
    rows: payload.items,
    total: payload.total,
    preview: previewSettlement(period),
    batches: listSettlementBatches(),
    weekAuditCount: listAuditByWeek(isoWeekOf(new Date())).length,
  }
}

export default function ResourceView({ actor }: { actor: Actor }) {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [period, setPeriod] = useState('2026-11')
  // 惰性初始值：首屏就带上本地数据，不必等 effect，服务端渲染 / 快照测试也能看到内容。
  const initial = readWorkspace({}, '2026-11')
  const [rows, setRows] = useState<EntryRow[]>(initial.rows)
  const [total, setTotal] = useState(initial.total)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [preview, setPreview] = useState<SettlementPreview | null>(initial.preview)
  const [batches, setBatches] = useState<SettlementBatch[]>(initial.batches)
  const [lastResult, setLastResult] = useState<SettlementResult | null>(null)
  const [form, setForm] = useState<Record<string, string>>(emptyForm)
  const [weekAuditCount, setWeekAuditCount] = useState(initial.weekAuditCount)
  const filterFields = useMemo(() => ['记录编号', '计算引擎', '作业名称'], [])

  const reload = useCallback(() => {
    try {
      const snapshot = readWorkspace(filters, period)
      setRows(snapshot.rows)
      setTotal(snapshot.total)
      setPreview(snapshot.preview)
      setBatches(snapshot.batches)
      setWeekAuditCount(snapshot.weekAuditCount)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '资源计量列表读取失败')
    }
  }, [filters, period])

  useEffect(() => {
    reload()
  }, [reload])

  const periods = useMemo(() => listPeriodOptions(), [rows, batches])
  const authorized = actor.role === '计算引擎负责人'
  const activeForPeriod = preview?.batch

  function runSettle(simulateWriteFailure = false) {
    setErrorMessage('')
    setSuccessMessage('')
    const result = settlePeriod(period, actor, { simulateWriteFailure })
    setLastResult(result)
    if (!result.ok) {
      setErrorMessage(result.message)
    } else {
      setSuccessMessage(result.message)
    }
    reload()
  }

  function submitMetering(event: React.FormEvent) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    const result = registerMetering({
      engine: form['计算引擎'],
      jobName: form['作业名称'],
      jobType: form['作业类型'] as MeteringJobType,
      jobId: form['作业编号'],
      cpuCoreSeconds: form['CPU核秒'],
      memoryGbSeconds: form['内存GB秒'],
      storageGb: form['存储占用GB'],
      scannedDataGb: form['扫描数据量'],
      period: form['计费周期'],
    }, actor)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    setSuccessMessage(result.message)
    setForm((prev) => ({ ...prev, 作业名称: '', 作业编号: '', CPU核秒: '', 内存GB秒: '', 存储占用GB: '', 扫描数据量: '' }))
    if (result.redirectedTo) {
      setPeriod(result.redirectedTo)
    }
    reload()
  }

  return (
    <section className="page" data-module="resource">
      <header className="page-head">
        <div>
          <h2>资源计量管理</h2>
          <p className="page-desc">
            按计费周期汇总流处理作业与批量转换任务的资源消耗，形成可复核的已结算记录与资源汇总结果。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出资源计量清单
          </button>
        </div>
      </header>

      {!authorized && (
        <p className="permission-banner" data-testid="resource-readonly">
          当前角色「{actor.role}」只读：{SETTLEMENT_ROLE_MESSAGE}
        </p>
      )}

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">计量记录总数</span>
          <strong className="stat-value">{total}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已结算记录</span>
          <strong className="stat-value">{rows.filter((row) => String(row.status) === '已结算').length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">待汇总记录</span>
          <strong className="stat-value">{rows.filter((row) => String(row.status) === '待汇总').length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">本周结算审计</span>
          <strong className="stat-value">{weekAuditCount}</strong>
        </article>
      </div>

      <p className="status-legend">
        {statuses.map((status) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
        <span className="legend-item">{CALIBER}</span>
      </p>

      <section className="panel" data-testid="settlement-panel">
        <header className="panel-head">
          <h3>周期结算</h3>
          <div className="panel-tools">
            <label className="filter-item">
              <span>计费周期</span>
              <input
                value={period}
                list="resource-period-options"
                placeholder="YYYY-MM"
                onChange={(event) => setPeriod(normalizePeriod(event.target.value))}
              />
            </label>
            <datalist id="resource-period-options">
              {periods.map((item) => (
                <option key={item.period} value={item.period}>
                  {`${item.period}（待汇总 ${item.pending} / 已结算 ${item.settled}）`}
                </option>
              ))}
            </datalist>
            <button
              className="btn primary"
              type="button"
              disabled={!authorized || !preview?.ok}
              onClick={() => runSettle(false)}
            >
              结算确认
            </button>
            <button
              className="btn"
              type="button"
              disabled={!authorized}
              onClick={() => runSettle(true)}
            >
              模拟写入失败
            </button>
          </div>
        </header>

        {preview && (
          <>
            <p className={preview.closed ? 'notice-text' : 'panel-hint'} data-testid="settlement-hint">
              {preview.message}
            </p>
            {preview.closed && activeForPeriod && (
              <p className="panel-hint">
                生效批次 {activeForPeriod.id} · 结算时间 {activeForPeriod.settledAt} · 操作人 {activeForPeriod.operator} ·
                记录 {activeForPeriod.totals.recordCount} 条
              </p>
            )}

            {preview.failedRows.length > 0 && (
              <table className="data-table compact" data-testid="settlement-failed-table">
                <thead>
                  <tr><th>记录编号</th><th>作业名称</th><th>失败原因</th></tr>
                </thead>
                <tbody>
                  {preview.failedRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.recordNo}</td>
                      <td>{row.jobName}</td>
                      <td>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview.summaries.length > 0 && (
              <table className="data-table compact" data-testid="settlement-summary-table">
                <thead>
                  <tr>
                    <th>计算引擎</th>
                    <th>记录数</th>
                    <th>流处理作业</th>
                    <th>批量转换任务</th>
                    <th>CPU核秒</th>
                    <th>内存GB秒</th>
                    <th>存储占用GB</th>
                    <th>扫描数据量</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.summaries.map((summary) => (
                    <tr key={summary.engine}>
                      <td>{summary.engine}</td>
                      <td>{summary.recordCount}</td>
                      <td>{summary.streamJobCount}</td>
                      <td>{summary.batchJobCount}</td>
                      <td>{summary.cpuCoreSeconds}</td>
                      <td>{summary.memoryGbSeconds}</td>
                      <td>{summary.storageGb}</td>
                      <td>{summary.scannedDataGb}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td>合计</td>
                    <td>{preview.totals.recordCount}</td>
                    <td>{preview.totals.streamJobCount}</td>
                    <td>{preview.totals.batchJobCount}</td>
                    <td>{preview.totals.cpuCoreSeconds}</td>
                    <td>{preview.totals.memoryGbSeconds}</td>
                    <td>{preview.totals.storageGb}</td>
                    <td>{preview.totals.scannedDataGb}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        )}

        {lastResult && !lastResult.ok && (
          <p className="error-text" data-testid="settlement-result">
            [{lastResult.code}] {lastResult.message}
          </p>
        )}
        {successMessage && <p className="success-text" data-testid="settlement-success">{successMessage}</p>}
        {errorMessage && <p className="error-text" data-testid="settlement-error">{errorMessage}</p>}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>计量记录补录</h3>
          <span className="panel-hint">补录到已结算周期时，历史快照保持不变，记录顺延进入下一周期</span>
        </header>
        <form className="metering-form" onSubmit={submitMetering}>
          <label className="filter-item">
            <span>计算引擎</span>
            <input value={form['计算引擎']} onChange={(event) => setForm((prev) => ({ ...prev, 计算引擎: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>作业名称</span>
            <input value={form['作业名称']} onChange={(event) => setForm((prev) => ({ ...prev, 作业名称: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>作业类型</span>
            <select value={form['作业类型']} onChange={(event) => setForm((prev) => ({ ...prev, 作业类型: event.target.value }))}>
              {JOB_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="filter-item">
            <span>作业编号</span>
            <input value={form['作业编号']} onChange={(event) => setForm((prev) => ({ ...prev, 作业编号: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>CPU核秒</span>
            <input value={form['CPU核秒']} onChange={(event) => setForm((prev) => ({ ...prev, CPU核秒: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>内存GB秒</span>
            <input value={form['内存GB秒']} onChange={(event) => setForm((prev) => ({ ...prev, 内存GB秒: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>存储占用GB</span>
            <input value={form['存储占用GB']} onChange={(event) => setForm((prev) => ({ ...prev, 存储占用GB: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>扫描数据量</span>
            <input value={form['扫描数据量']} onChange={(event) => setForm((prev) => ({ ...prev, 扫描数据量: event.target.value }))} />
          </label>
          <label className="filter-item">
            <span>计费周期</span>
            <input value={form['计费周期']} onChange={(event) => setForm((prev) => ({ ...prev, 计费周期: event.target.value }))} />
          </label>
          <button className="btn primary" type="submit" disabled={!authorized}>
            登记计量记录
          </button>
        </form>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>已结算批次</h3>
          <span className="panel-hint">周期 {currentPeriod()} 为当前账期；历史批次按原周期快照保留</span>
        </header>
        <table className="data-table compact" data-testid="settlement-batches">
          <thead>
            <tr>
              <th>结算批次</th>
              <th>计费周期</th>
              <th>结算时间</th>
              <th>周次</th>
              <th>操作人</th>
              <th>记录数</th>
              <th>CPU核秒</th>
              <th>内存GB秒</th>
              <th>存储占用GB</th>
              <th>审计日志</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td>{batch.id}</td>
                <td>{batch.period}</td>
                <td>{batch.settledAt}</td>
                <td>{batch.week}</td>
                <td>{batch.operatorRole}-{batch.operator}</td>
                <td>{batch.totals.recordCount}</td>
                <td>{batch.totals.cpuCoreSeconds}</td>
                <td>{batch.totals.memoryGbSeconds}</td>
                <td>{batch.totals.storageGb}</td>
                <td>{batch.auditLogId ? `AUDI-${String(batch.auditLogId).padStart(4, '0')}` : '—'}</td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={10}>尚无生效的结算批次</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

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
            <th>结算批次</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status}</td>
              <td>{row['结算批次'] || '—'}</td>
              <td className="row-actions">
                <button
                  className="link"
                  type="button"
                  disabled={!authorized}
                  title={authorized ? '结算该记录所在周期' : SETTLEMENT_ROLE_MESSAGE}
                  onClick={() => {
                    const targetPeriod = String(row['计费周期'] ?? period)
                    setPeriod(targetPeriod)
                    const result = settlePeriod(targetPeriod, actor)
                    setLastResult(result)
                    setErrorMessage(result.ok ? '' : result.message)
                    setSuccessMessage(result.ok ? result.message : '')
                    reload()
                  }}
                >
                  结算确认
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 3}>暂无资源计量数据，可先登记计量记录</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条资源计量记录 · {CALIBER}</span>
      </footer>
    </section>
  )
}
