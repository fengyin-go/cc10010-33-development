/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

export type Role = '计算引擎负责人' | '值班管理员' | '数据开发'

export type Actor = {
  name: string
  role: Role
}

/** 动作入口的调用者：允许传当前会话或 undefined（未登录一律按只读）。 */
export type ActionActor = Actor | undefined | null

export type MeteringJobType = '流处理作业' | '批量转换任务'

export type SettlementSummary = {
  engine: string
  period: string
  recordCount: number
  streamJobCount: number
  batchJobCount: number
  cpuCoreSeconds: number
  memoryGbSeconds: number
  storageGb: number
  scannedDataGb: number
  recordIds: number[]
}

export type SettlementTotals = {
  recordCount: number
  streamJobCount: number
  batchJobCount: number
  cpuCoreSeconds: number
  memoryGbSeconds: number
  storageGb: number
  scannedDataGb: number
}

export type SettlementBatch = {
  id: string
  period: string
  settledAt: string
  /** 结算动作发生的 ISO 周次，审计明细按周记录结算结果。 */
  week: string
  operator: string
  operatorRole: Role
  recordIds: number[]
  summaries: SettlementSummary[]
  totals: SettlementTotals
  caliber: string
  status: '生效'
  idempotencyKey: string
  version: number
  auditLogId?: number
}

export type SettlementFailure = {
  at: string
  period: string
  operator: string
  reasons: FailedRow[]
}

export type SettlementState = {
  batches: SettlementBatch[]
  failures: SettlementFailure[]
  /** 结算快照的修订号，用于提交前的乐观并发校验。 */
  version: number
}

export type FailedRow = {
  id: number
  recordNo: string
  jobName: string
  reason: string
}

export type SettlementPreview = {
  ok: boolean
  message: string
  period: string
  closed: boolean
  batch?: SettlementBatch
  summaries: SettlementSummary[]
  totals: SettlementTotals
  records: EntryRow[]
  failedRows: FailedRow[]
  pendingCount: number
  draftCount: number
  settledCount: number
}

export type SettlementResult = {
  ok: boolean
  code: 'OK' | 'FORBIDDEN' | 'BUSY' | 'DUPLICATE' | 'NO_RECORDS' | 'VALIDATION_FAILED' | 'WRITE_FAILED'
  message: string
  batch?: SettlementBatch
  failedRows?: FailedRow[]
  rolledBack?: boolean
  auditLogId?: number
}

export type SettleOptions = {
  /** 演示用：在写入资源记录与结算结果后抛出错误，验证整体回退。 */
  simulateWriteFailure?: boolean
}

export type MeteringInput = {
  engine: string
  jobName: string
  jobType: MeteringJobType
  jobId: string
  cpuCoreSeconds: string
  memoryGbSeconds: string
  storageGb: string
  scannedDataGb: string
  period: string
}

export type RegisterMeteringResult = {
  ok: boolean
  message: string
  row?: EntryRow
  redirectedFrom?: string
  redirectedTo?: string
}

export type PeriodOption = {
  period: string
  total: number
  pending: number
  draft: number
  settled: number
  closed: boolean
}
