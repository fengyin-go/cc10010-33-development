import type { Actor, Role } from './types'

// 角色与动作权限：结算类动作只对「计算引擎负责人」开放，其余角色一律只读。
export const ROLES: Role[] = ['计算引擎负责人', '值班管理员', '数据开发']

export const DEFAULT_ACTOR: Actor = { name: '林工', role: '计算引擎负责人' }

export const READ_ONLY_ACTOR: Actor = { name: '值班管理员', role: '值班管理员' }

export function canSettle(actor: Actor | undefined | null): boolean {
  return Boolean(actor && actor.role === '计算引擎负责人')
}

export function isReadOnly(actor: Actor | undefined | null): boolean {
  return !canSettle(actor)
}

export function actorLabel(actor: Actor | undefined | null): string {
  if (!actor) {
    return '未知用户'
  }
  return actor.role === '计算引擎负责人' ? `${actor.role}-${actor.name}` : actor.role
}
