import type { SettlementState } from './types'

// 结算结果独立持久化：已结算快照与失败明细和历史计量记录分开存，互不覆盖。
const SETTLEMENT_KEY = 'lake-govern-config:settlements'
// 周期锁与结算快照共用 localStorage：同一浏览器多个标签页也只有一个结算能生效。
const LOCK_KEY = 'lake-govern-config:settlement-lock'
const LOCK_STALE_MS = 30_000

function emptyState(): SettlementState {
  return { batches: [], failures: [], version: 0 }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

let cache: SettlementState | null = null

function readStorage(): SettlementState {
  const fallback = emptyState()
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(SETTLEMENT_KEY)
  if (!raw) {
    window.localStorage.setItem(SETTLEMENT_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SettlementState>
    return {
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      failures: Array.isArray(parsed.failures) ? parsed.failures : [],
      version: typeof parsed.version === 'number' ? parsed.version : 0,
    }
  } catch {
    window.localStorage.setItem(SETTLEMENT_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function settlementState(): SettlementState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveSettlementState(state: SettlementState): void {
  // 先写持久层再更新内存缓存：写失败时缓存保持原值，结算引擎才能正确整体回退。
  if (hasStorage()) {
    window.localStorage.setItem(SETTLEMENT_KEY, JSON.stringify(state))
  }
  cache = state
}

/** 重新读取持久层：另一个标签页可能已经写入结算结果，提交前必须看到最新状态。 */
export function refreshSettlementState(): SettlementState {
  cache = readStorage()
  return cache
}

type LockRecord = { owner: string; at: number }

/**
 * 尝试独占一个周期。成功返回释放函数，失败返回 null（说明已有结算在进行）。
 * 过期锁（超过 30 秒没释放，例如页面被杀）自动失效，避免永久卡死。
 */
export function acquirePeriodLock(period: string): (() => void) | null {
  if (!hasStorage()) {
    return () => {}
  }
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const key = `${LOCK_KEY}:${period}`
  const existing = readLock(key)
  if (existing && Date.now() - existing.at < LOCK_STALE_MS) {
    return null
  }
  window.localStorage.setItem(key, JSON.stringify({ owner, at: Date.now() } satisfies LockRecord))
  // 立即回读校验：并发写入时后写者会覆盖前写者，只有读回自己的 owner 才算拿到锁。
  const confirmed = readLock(key)
  if (confirmed?.owner !== owner) {
    return null
  }
  return () => {
    const current = readLock(key)
    if (current?.owner === owner) {
      window.localStorage.removeItem(key)
    }
  }
}

function readLock(key: string): LockRecord | null {
  if (!hasStorage()) {
    return null
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as LockRecord
    return typeof parsed.owner === 'string' && typeof parsed.at === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function resetSettlements(): SettlementState {
  const next = emptyState()
  saveSettlementState(next)
  if (hasStorage()) {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(LOCK_KEY)) {
        window.localStorage.removeItem(key)
      }
    }
  }
  return next
}

export function settlementStorageKey(): string {
  return SETTLEMENT_KEY
}

export function settlementSnapshot<T>(value: T): T {
  return clone(value)
}
