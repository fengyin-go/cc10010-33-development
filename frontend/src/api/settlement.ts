import { actorLabel, canSettle } from '@/data/permissions'
import { listRows, refreshRows, saveRows } from '@/data/local-store'
import { saveSettlementState, settlementState, refreshSettlementState, acquirePeriodLock } from '@/data/settlement-store'
import type {
  Actor,
  EntryRow,
  FailedRow,
  MeteringInput,
  MeteringJobType,
  PeriodOption,
  RegisterMeteringResult,
  SettlementBatch,
  SettlementFailure,
  SettlementPreview,
  SettlementResult,
  SettlementSummary,
  SettlementTotals,
  SettleOptions,
} from '@/data/types'

// 周期结算引擎：按「计费周期 + 计算引擎」汇总流处理作业与批量转换任务的资源消耗。
// 结算结果是一次不可变快照：历史已结算批次不会被后续补录或重新结算改写。

const PERIOD_PATTERN = /^(\d{4})-(\d{2})$/
const JOB_TYPES: MeteringJobType[] = ['流处理作业', '批量转换任务']
const METER_FIELDS = ['CPU核秒', '内存GB秒', '存储占用GB', '扫描数据量'] as const
export const CALIBER = '原资源口径：CPU核秒 / 内存GB秒 / 存储占用GB / 扫描数据量'
export const SETTLE_ACTION = '结算确认'
export const SETTLEMENT_ROLE_MESSAGE = '仅计算引擎负责人可执行结算，其他角色只读'

// 结算中的周期锁：同一周期同时只允许一个结算在跑，并发提交直接拒绝，避免重复计费。
// 放在模块级而不是 localStorage：刷新会清空，但真正的幂等保护是下面的「每周期一个生效批次」。
const inFlightPeriods = new Set<string>()

export function isValidPeriod(period: string): boolean {
  const match = PERIOD_PATTERN.exec(String(period ?? '').trim())
  if (!match) {
    return false
  }
  const month = Number(match[2])
  return month >= 1 && month <= 12
}

export function normalizePeriod(period: string): string {
  return String(period ?? '').trim()
}

export function nextPeriod(period: string): string {
  const match = PERIOD_PATTERN.exec(normalizePeriod(period))
  if (!match) {
    return ''
  }
  const year = Number(match[1])
  const month = Number(match[2])
  return month >= 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 当前计费周期：按运行日期取年月。 */
export function currentPeriod(): string {
  return periodOf(new Date())
}

/** ISO 8601 周次，用于审计明细按周记录结算结果。 */
export function isoWeekOf(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const weekday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - weekday + 3)
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4))
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3)
  const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function nowStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN
  }
  const text = String(value ?? '').trim()
  return text === '' ? NaN : Number(text)
}

function rowPeriod(row: EntryRow): string {
  return normalizePeriod(String(row['计费周期'] ?? ''))
}

function jobTypeOf(row: EntryRow): string {
  return String(row['作业类型'] ?? '')
}

/** 已生效的结算批次：一个周期只保留一个生效结果，先到先得。 */
export function activeBatch(period: string): SettlementBatch | undefined {
  const normalized = normalizePeriod(period)
  return settlementState().batches.find(
    (batch) => normalizePeriod(batch.period) === normalized && batch.status === '生效',
  )
}

export function periodClosed(period: string): boolean {
  return Boolean(activeBatch(period))
}

export function listSettlementBatches(): SettlementBatch[] {
  return [...settlementState().batches].sort((left, right) => right.period.localeCompare(left.period))
}

export function listSettlementFailures(): SettlementFailure[] {
  return [...settlementState().failures]
}

export function listAuditByWeek(week: string): EntryRow[] {
  return listRows('audit').filter((row) => String(row['周次'] ?? '') === week)
}

export function listPeriodOptions(): PeriodOption[] {
  const grouped = new Map<string, PeriodOption>()
  for (const row of listRows('resource')) {
    const period = rowPeriod(row)
    if (!period) {
      continue
    }
    const option = grouped.get(period) ?? {
      period,
      total: 0,
      pending: 0,
      draft: 0,
      settled: 0,
      closed: periodClosed(period),
    }
    option.total += 1
    const status = String(row.status)
    if (status === '待汇总') {
      option.pending += 1
    } else if (status === '草稿') {
      option.draft += 1
    } else if (status === '已结算' || status === '已归档') {
      option.settled += 1
    }
    grouped.set(period, option)
  }
  return [...grouped.values()].sort((left, right) => right.period.localeCompare(left.period))
}

/** 校验一条待结算记录是否具备进入周期结算的条件。 */
function validateRow(row: EntryRow, period: string): string | null {
  if (!String(row['计算引擎'] ?? '').trim()) {
    return '计算引擎为空'
  }
  if (!String(row['作业名称'] ?? '').trim()) {
    return '作业名称为空'
  }
  const jobType = jobTypeOf(row)
  if (!JOB_TYPES.includes(jobType as MeteringJobType)) {
    return `作业类型「${jobType || '空'}」不在周期结算范围（仅流处理作业与批量转换任务）`
  }
  const value = rowPeriod(row)
  if (value !== period) {
    return `计费周期「${value || '空'}」与结算周期 ${period} 不一致`
  }
  for (const field of METER_FIELDS) {
    const amount = toNumber(row[field])
    if (Number.isNaN(amount)) {
      return `${field}「${row[field] ?? ''}」不是有效数值`
    }
    if (amount < 0) {
      return `${field}不能为负数`
    }
  }
  return null
}

function emptyTotals(): SettlementTotals {
  return {
    recordCount: 0,
    streamJobCount: 0,
    batchJobCount: 0,
    cpuCoreSeconds: 0,
    memoryGbSeconds: 0,
    storageGb: 0,
    scannedDataGb: 0,
  }
}

function buildSummaries(rows: EntryRow[], period: string): SettlementSummary[] {
  const grouped = new Map<string, SettlementSummary>()
  for (const row of rows) {
    const engine = String(row['计算引擎']).trim()
    const summary = grouped.get(engine) ?? {
      engine,
      period,
      recordCount: 0,
      streamJobCount: 0,
      batchJobCount: 0,
      cpuCoreSeconds: 0,
      memoryGbSeconds: 0,
      storageGb: 0,
      scannedDataGb: 0,
      recordIds: [],
    }
    summary.recordCount += 1
    if (jobTypeOf(row) === '流处理作业') {
      summary.streamJobCount += 1
    } else {
      summary.batchJobCount += 1
    }
    summary.cpuCoreSeconds += toNumber(row['CPU核秒'])
    summary.memoryGbSeconds += toNumber(row['内存GB秒'])
    summary.storageGb += toNumber(row['存储占用GB'])
    summary.scannedDataGb += toNumber(row['扫描数据量'])
    summary.recordIds.push(Number(row.id))
    grouped.set(engine, summary)
  }
  return [...grouped.values()]
    .map((summary) => ({ ...summary, recordIds: [...summary.recordIds].sort((a, b) => a - b) }))
    .sort((left, right) => left.engine.localeCompare(right.engine))
}

function buildTotals(summaries: SettlementSummary[]): SettlementTotals {
  return summaries.reduce<SettlementTotals>((totals, summary) => ({
    recordCount: totals.recordCount + summary.recordCount,
    streamJobCount: totals.streamJobCount + summary.streamJobCount,
    batchJobCount: totals.batchJobCount + summary.batchJobCount,
    cpuCoreSeconds: totals.cpuCoreSeconds + summary.cpuCoreSeconds,
    memoryGbSeconds: totals.memoryGbSeconds + summary.memoryGbSeconds,
    storageGb: totals.storageGb + summary.storageGb,
    scannedDataGb: totals.scannedDataGb + summary.scannedDataGb,
  }), emptyTotals())
}

function failedRow(row: EntryRow, reason: string): FailedRow {
  return {
    id: Number(row.id),
    recordNo: String(row['记录编号'] ?? ''),
    jobName: String(row['作业名称'] ?? ''),
    reason,
  }
}

function previewMessage(
  period: string,
  closed: boolean,
  validCount: number,
  failedCount: number,
  draftCount: number,
): string {
  if (!isValidPeriod(period)) {
    return '计费周期格式应为 YYYY-MM'
  }
  if (closed) {
    return `周期 ${period} 已结算，结果已按原周期快照保留；新补录只能进入下一周期 ${nextPeriod(period)}`
  }
  if (failedCount > 0) {
    return `周期 ${period} 有 ${failedCount} 条待汇总记录校验不通过，请先修正`
  }
  if (validCount === 0) {
    return draftCount > 0
      ? `周期 ${period} 没有可结算的待汇总记录（${draftCount} 条草稿需先提交汇总）`
      : `周期 ${period} 没有待汇总的计量记录`
  }
  return `周期 ${period} 可结算 ${validCount} 条记录`
}

/** 结算预览：只读计算，不写任何数据。 */
export function previewSettlement(period: string): SettlementPreview {
  const normalized = normalizePeriod(period)
  const records = isValidPeriod(normalized)
    ? listRows('resource').filter((row) => rowPeriod(row) === normalized)
    : []
  const pendingRows = records.filter((row) => String(row.status) === '待汇总')
  const failedRows: FailedRow[] = []
  for (const row of pendingRows) {
    const reason = validateRow(row, normalized)
    if (reason) {
      failedRows.push(failedRow(row, reason))
    }
  }
  const failedIds = new Set(failedRows.map((row) => row.id))
  const validRows = pendingRows.filter((row) => !failedIds.has(Number(row.id)))
  const summaries = buildSummaries(validRows, normalized)
  const totals = buildTotals(summaries)
  const closed = isValidPeriod(normalized) ? periodClosed(normalized) : false
  const settledCount = records.filter((row) => ['已结算', '已归档'].includes(String(row.status))).length
  const draftCount = records.filter((row) => String(row.status) === '草稿').length
  return {
    ok: isValidPeriod(normalized) && !closed && failedRows.length === 0 && validRows.length > 0,
    message: previewMessage(normalized, closed, validRows.length, failedRows.length, draftCount),
    period: normalized,
    closed,
    batch: closed ? activeBatch(normalized) : undefined,
    summaries,
    totals,
    records: validRows,
    failedRows,
    pendingCount: pendingRows.length,
    draftCount,
    settledCount,
  }
}

function nextAuditId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function buildAuditRow(batch: SettlementBatch, id: number): EntryRow {
  const { totals, summaries } = batch
  const detail = [
    `周期 ${batch.period} 结算完成（${batch.caliber}）`,
    `${totals.recordCount} 条记录：流处理 ${totals.streamJobCount} / 批量 ${totals.batchJobCount}`,
    `CPU ${totals.cpuCoreSeconds} 核秒，内存 ${totals.memoryGbSeconds} GB秒`,
    `存储 ${totals.storageGb} GB，扫描 ${totals.scannedDataGb} GB`,
    `覆盖引擎：${summaries.map((item) => item.engine).join('、')}`,
  ].join('；')
  return {
    id,
    status: '待审核',
    pending: true,
    abnormal: false,
    '日志编号': `AUDI-${String(id).padStart(4, '0')}`,
    '操作类型': SETTLE_ACTION,
    '操作对象': `资源计量-${batch.period}`,
    '操作详情': detail,
    '操作来源': `${batch.operatorRole}-${batch.operator}`,
    '执行时间': batch.settledAt,
    '影响行数': String(totals.recordCount),
    '回滚能力': '不可回滚',
    '结算周期': batch.period,
    '结算批次': batch.id,
    '周次': batch.week,
  }
}

function buildBatchId(period: string, sequence: number): string {
  return `STLB-${period}-${String(sequence).padStart(3, '0')}`
}

function appendAudit(batch: SettlementBatch): { id: number; row: EntryRow; added: boolean } {
  const rows = listRows('audit')
  const duplicate = rows.find((row) => String(row['结算批次'] ?? '') === batch.id)
  if (duplicate) {
    // 同一批次已有审计行：复用而不是再追加一条，避免明细重复。
    return { id: Number(duplicate.id), row: duplicate, added: false }
  }
  const auditId = nextAuditId(rows)
  return { id: auditId, row: buildAuditRow(batch, auditId), added: true }
}

function removeAuditByBatch(batchId: string): void {
  if (!batchId) {
    return
  }
  const rows = listRows('audit')
  const next = rows.filter((row) => String(row['结算批次'] ?? '') !== batchId)
  if (next.length !== rows.length) {
    saveRows('audit', next)
  }
}

/** 用结算前的原始行逐字恢复，其他周期、其他记录不受影响。 */
function restoreResourceRows(originals: EntryRow[]): void {
  const restored = new Map(originals.map((row) => [Number(row.id), row]))
  saveRows('resource', listRows('resource').map((row) => restored.get(Number(row.id)) ?? row))
}

/**
 * 结算一个计费周期。
 * - 只有「计算引擎负责人」可以执行，其他角色直接拒绝且不写任何数据。
 * - 同一周期只允许一个生效结果；重复结算返回已有批次，不会重复计费。
 * - 并发提交通过周期锁拒绝后进行中的请求。
 * - 写入中途失败时资源记录整体退回「待汇总」，结算批次不落库，失败行保留。
 */
export function settlePeriod(
  period: string,
  actor: Actor | undefined | null,
  options: SettleOptions = {},
): SettlementResult {
  const normalized = normalizePeriod(period)

  if (!canSettle(actor)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `无权结算：${SETTLEMENT_ROLE_MESSAGE}（当前：${actorLabel(actor)}）`,
    }
  }
  if (!isValidPeriod(normalized)) {
    return { ok: false, code: 'VALIDATION_FAILED', message: '计费周期格式应为 YYYY-MM，例如 2026-11' }
  }

  // 另一个标签页可能刚结算过：先看磁盘最新状态再判断重复与并发。
  refreshRows()
  refreshSettlementState()
  const existing = activeBatch(normalized)
  if (existing) {
    return {
      ok: false,
      code: 'DUPLICATE',
      message: `周期 ${normalized} 已由批次 ${existing.id} 结算生效，同一周期只允许一个结果，本次提交未重复计费`,
      batch: existing,
      auditLogId: existing.auditLogId,
    }
  }
  if (inFlightPeriods.has(normalized)) {
    return {
      ok: false,
      code: 'BUSY',
      message: `周期 ${normalized} 正在结算中，并发提交已拒绝，请等待当前结算完成`,
    }
  }

  // 跨标签页的周期锁：拿不到说明另一个标签页正在结算同一周期。
  const releaseLock = acquirePeriodLock(normalized)
  if (!releaseLock) {
    return {
      ok: false,
      code: 'BUSY',
      message: `周期 ${normalized} 正在其他页面结算中，并发提交已拒绝，请等待当前结算完成`,
    }
  }

  inFlightPeriods.add(normalized)
  const stamp = nowStamp()
  const snapshotVersion = settlementState().version
  const preview = previewSettlement(normalized)
  // 回退用的现场快照：进入写入阶段后才有值，catch 里据此逐字恢复。
  let originalsSnapshot: EntryRow[] = []
  let batchIdSnapshot = ''
  try {
    if (preview.failedRows.length > 0) {
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        message: `周期 ${normalized} 有 ${preview.failedRows.length} 条记录校验不通过，已整体退回待汇总`,
        failedRows: preview.failedRows,
        rolledBack: true,
      }
    }
    if (preview.records.length === 0) {
      return { ok: false, code: 'NO_RECORDS', message: preview.message }
    }

    const state = settlementState()
    if (state.version !== snapshotVersion) {
      return {
        ok: false,
        code: 'BUSY',
        message: '结算数据在提交期间被其他请求修改，请刷新后重试',
      }
    }

    const batchId = buildBatchId(
      normalized,
      state.batches.filter((batch) => normalizePeriod(batch.period) === normalized).length + 1,
    )
    const recordIds = preview.records.map((row) => Number(row.id))
    const batch: SettlementBatch = {
      id: batchId,
      period: normalized,
      settledAt: stamp,
      week: isoWeekOf(new Date()),
      operator: actor!.name,
      operatorRole: actor!.role,
      recordIds,
      summaries: preview.summaries,
      totals: preview.totals,
      caliber: CALIBER,
      status: '生效',
      idempotencyKey: `settle:${normalized}`,
      version: state.batches.length + 1,
    }

    // 1) 资源记录落到「已结算」，同时写入结算批次与结算时间。结算前先留原行快照。
    const selected = new Set(recordIds)
    originalsSnapshot = listRows('resource').filter((row) => selected.has(Number(row.id)))
    batchIdSnapshot = batchId
    saveRows('resource', listRows('resource').map((row) => (
      selected.has(Number(row.id))
        ? { ...row, status: '已结算', pending: false, abnormal: false, '结算批次': batchId, '结算时间': stamp }
        : row
    )))

    // 2) 写入失败演练：资源记录已改，但结算结果尚未落库，必须整体回退。
    if (options.simulateWriteFailure) {
      throw new Error('模拟结算结果写入失败')
    }

    // 3) 审计明细按周记录本周结算结果；写失败同样整体回退。
    const auditRow = appendAudit(batch)
    if (auditRow.added) {
      saveRows('audit', [...listRows('audit'), auditRow.row])
    }

    // 4) 结算快照落库，周期从此锁定；后续补录只能进入下一周期。
    const withAudit: SettlementBatch = { ...batch, auditLogId: auditRow.id }
    saveSettlementState({
      batches: [...state.batches, withAudit],
      failures: state.failures,
      version: state.version + 1,
    })

    return {
      ok: true,
      code: 'OK',
      message: `周期 ${normalized} 结算完成，批次 ${batchId} 生效，共 ${batch.totals.recordCount} 条记录`,
      batch: withAudit,
      auditLogId: auditRow.id,
    }
  } catch (error) {
    // 整体退回待汇总：资源记录逐字恢复原行，结算批次不落库，审计行撤销，失败行保留。
    restoreResourceRows(originalsSnapshot)
    removeAuditByBatch(batchIdSnapshot)
    const failedRows: FailedRow[] = preview.records.map((row) => ({
      id: Number(row.id),
      recordNo: String(row['记录编号'] ?? ''),
      jobName: String(row['作业名称'] ?? ''),
      reason: '结算写入失败，已退回待汇总',
    }))
    const current = settlementState()
    saveSettlementState({
      batches: current.batches,
      failures: [
        ...current.failures,
        { at: stamp, period: normalized, operator: actor?.name ?? '', reasons: failedRows },
      ],
      version: current.version,
    })
    return {
      ok: false,
      code: 'WRITE_FAILED',
      message: `周期 ${normalized} 结算写入失败（${error instanceof Error ? error.message : '未知错误'}），${failedRows.length} 条记录已整体退回待汇总`,
      failedRows,
      rolledBack: true,
    }
  } finally {
    inFlightPeriods.delete(normalized)
    releaseLock()
  }
}

/**
 * 登记/补录计量记录。
 * 若指定的计费周期已结算，不能写回历史周期：自动顺延到下一周期并打上补录标记，
 * 历史已结算记录仍按原周期快照保留。
 */
export function registerMetering(input: MeteringInput, actor: Actor | undefined | null): RegisterMeteringResult {
  if (!canSettle(actor)) {
    return { ok: false, message: `无权登记计量记录：${SETTLEMENT_ROLE_MESSAGE}` }
  }
  const period = normalizePeriod(input.period)
  if (!isValidPeriod(period)) {
    return { ok: false, message: '计费周期格式应为 YYYY-MM，例如 2026-11' }
  }
  if (!String(input.engine ?? '').trim()) {
    return { ok: false, message: '计算引擎不能为空' }
  }
  if (!String(input.jobName ?? '').trim()) {
    return { ok: false, message: '作业名称不能为空' }
  }
  if (!JOB_TYPES.includes(input.jobType)) {
    return { ok: false, message: '作业类型只能是流处理作业或批量转换任务' }
  }
  for (const [field, value] of [
    ['CPU核秒', input.cpuCoreSeconds],
    ['内存GB秒', input.memoryGbSeconds],
    ['存储占用GB', input.storageGb],
    ['扫描数据量', input.scannedDataGb],
  ] as const) {
    const amount = toNumber(value)
    if (Number.isNaN(amount) || amount < 0) {
      return { ok: false, message: `${field}需要填写不小于 0 的数值` }
    }
  }

  const rows = listRows('resource')
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const backfilled = periodClosed(period)
  const targetPeriod = backfilled ? nextPeriod(period) : period
  const row: EntryRow = {
    id,
    status: '待汇总',
    pending: true,
    abnormal: false,
    '记录编号': `RESO-${String(id).padStart(4, '0')}`,
    '计算引擎': input.engine.trim(),
    '作业名称': input.jobName.trim(),
    '作业类型': input.jobType,
    '作业编号': String(input.jobId ?? '').trim(),
    'CPU核秒': toNumber(input.cpuCoreSeconds),
    '内存GB秒': toNumber(input.memoryGbSeconds),
    '存储占用GB': toNumber(input.storageGb),
    '扫描数据量': toNumber(input.scannedDataGb),
    '计费周期': targetPeriod,
    '补录标记': backfilled ? '是' : '否',
    '原始计费周期': period,
    '结算批次': '',
    '结算时间': '',
  }
  saveRows('resource', [...rows, row])
  return {
    ok: true,
    message: backfilled
      ? `周期 ${period} 已结算，补录记录已顺延进入下一周期 ${targetPeriod}`
      : `计量记录已登记到周期 ${targetPeriod}，当前待汇总`,
    row,
    redirectedFrom: backfilled ? period : undefined,
    redirectedTo: backfilled ? targetPeriod : undefined,
  }
}
