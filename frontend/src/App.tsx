import { useCallback, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'

import Overview from './views/Overview'
import CatalogView from './views/catalog'
import IngestView from './views/ingest'
import BronzeView from './views/bronze'
import SilverView from './views/silver'
import GoldView from './views/gold'
import LakezoneView from './views/lakezone'
import StreamView from './views/stream'
import BatchView from './views/batch'
import SnapshotView from './views/snapshot'
import GovernView from './views/govern'
import MetaView from './views/meta'
import LineageView from './views/lineage'
import QualityView from './views/quality'
import ScheduleView from './views/schedule'
import BackfillView from './views/backfill'
import SearchView from './views/search'
import ResourceView from './views/resource'
import AuditView from './views/audit'
import { DEFAULT_ACTOR, READ_ONLY_ACTOR, ROLES } from './data/permissions'
import type { Actor, Role } from './data/types'

const navItems = [{ label: "运营概览", path: "/" }, { label: "数据编目", path: "/catalog" }, { label: "多源接入", path: "/ingest" }, { label: "原始层管理", path: "/bronze" }, { label: "清洗层管理", path: "/silver" }, { label: "聚合层管理", path: "/gold" }, { label: "湖区分区", path: "/lakezone" }, { label: "流式处理", path: "/stream" }, { label: "批量转换", path: "/batch" }, { label: "版本快照", path: "/snapshot" }, { label: "湖仓治理", path: "/govern" }, { label: "元数据中心", path: "/meta" }, { label: "血缘图谱", path: "/lineage" }, { label: "质量监控", path: "/quality" }, { label: "编排调度", path: "/schedule" }, { label: "历史回填", path: "/backfill" }, { label: "数据检索", path: "/search" }, { label: "资源计量", path: "/resource" }, { label: "操作审计", path: "/audit" }]

export default function App() {
  const [actor, setActor] = useState<Actor>(DEFAULT_ACTOR)

  const switchRole = useCallback((role: Role) => {
    setActor(role === '计算引擎负责人' ? { ...DEFAULT_ACTOR, role } : { ...READ_ONLY_ACTOR, role })
  }, [])

  return (
    <div className="app-shell">
      <aside className="app-side">
        <h1 className="app-title">数据湖治理配置中心</h1>
        <nav className="nav-list">
          {navItems.map((item) => (
            <Link key={item.path} to={item.path} className="nav-item">
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="app-main">
        <header className="app-head">
          <span className="head-desc">离线版数据湖治理配置工具，涵盖多源接入通道、分层表结构设计、湖区分区策略、流批转换编排、元数据编目检索与资源计量管理，所有配置持久化到浏览器本地存储。</span>
          <label className="head-user">
            当前角色：
            <select
              className="role-select"
              value={actor.role}
              onChange={(event) => switchRole(event.target.value as Role)}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <span className="role-note">（{actor.role === '计算引擎负责人' ? '可结算' : '只读'}）</span>
          </label>
        </header>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/catalog" element={<CatalogView />} />
          <Route path="/ingest" element={<IngestView />} />
          <Route path="/bronze" element={<BronzeView />} />
          <Route path="/silver" element={<SilverView />} />
          <Route path="/gold" element={<GoldView />} />
          <Route path="/lakezone" element={<LakezoneView />} />
          <Route path="/stream" element={<StreamView />} />
          <Route path="/batch" element={<BatchView />} />
          <Route path="/snapshot" element={<SnapshotView />} />
          <Route path="/govern" element={<GovernView />} />
          <Route path="/meta" element={<MetaView />} />
          <Route path="/lineage" element={<LineageView />} />
          <Route path="/quality" element={<QualityView />} />
          <Route path="/schedule" element={<ScheduleView />} />
          <Route path="/backfill" element={<BackfillView />} />
          <Route path="/search" element={<SearchView />} />
          <Route path="/resource" element={<ResourceView actor={actor} />} />
          <Route path="/audit" element={<AuditView />} />
        </Routes>
      </main>
    </div>
  )
}
