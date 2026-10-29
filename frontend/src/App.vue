<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { Activity, Cable, Cpu, Waves, Radio, Wifi, Database, FileText, ListTodo, PanelBottom, X, ExternalLink, ChevronLeft, ChevronRight, CircleHelp, Moon, Sun, Circle, FlaskConical, Square, Braces, Command, CheckCircle2 } from '@lucide/vue'
import { useStudio } from './stores/studio'
import type { PageId } from './types'
import LogView from './components/LogView.vue'

const ConnectionsView = defineAsyncComponent(() => import('./views/ConnectionsView.vue'))
const RegistersView = defineAsyncComponent(() => import('./views/RegistersView.vue'))
const TasksView = defineAsyncComponent(() => import('./views/TasksView.vue'))
const studio = useStudio()
const workspaceElement = ref<HTMLElement>()
const sidebarToggleTop = ref<number>()
function positionSidebarToggle(event: PointerEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  sidebarToggleTop.value = Math.max(24, Math.min(bounds.height - 24, event.clientY - bounds.top))
}
watch(() => studio.activeTab, () => workspaceElement.value?.scrollTo({ top: 0, left: 0 }), { flush: 'post' })
const titles: Record<PageId, string> = { connections: '连接中心', registers: '寄存器工作台', tasks: '任务中心', logs: '日志中心', about: '关于 TestStudio' }
const icons = { connections: Cable, registers: Cpu, tasks: ListTodo, logs: FileText, about: CircleHelp }
const onlineCount = computed(() => studio.connections.filter(item => item.status === 'connected').length)
const activeView = computed(() => ({ connections: ConnectionsView, registers: RegistersView, tasks: TasksView })[studio.activeTab as 'connections' | 'registers' | 'tasks'])
onMounted(studio.initialize)
onUnmounted(studio.dispose)
</script>

<template>
  <div class="studio-app" :data-theme="studio.theme">
    <aside v-show="studio.sidebarVisible" id="primary-sidebar" class="sidebar" aria-label="主导航"><div class="brand"><div class="brand-symbol"><Activity :size="23" /></div><div>Test<span>Studio</span><small>CHIP DEBUG WORKBENCH</small></div></div>
      <div class="workspace-name"><span class="workspace-dot" />本地工作区<span class="version-pill">v0.1</span></div>
      <div class="nav-section-label">工作台</div>
      <nav aria-label="功能导航"><button v-for="id in (['connections', 'registers'] as PageId[])" :key="id" class="nav-item" :class="{ active: studio.activeTab === id }" @click="studio.openTab(id)"><component :is="icons[id]" :size="18" /><span>{{ titles[id] }}</span><ChevronRight v-if="studio.activeTab === id" class="nav-arrow" :size="14" /></button>
        <button v-for="item in [{ name: 'IQ 采集与回放', icon: Waves }, { name: '逻辑分析仪', icon: Braces }, { name: 'BLE 测试', icon: Radio }, { name: 'WiFi 测试', icon: Wifi }]" :key="item.name" class="nav-item planned" disabled :title="`${item.name} 尚未实现`"><component :is="item.icon" :size="18" /><span>{{ item.name }}</span><small>规划</small></button>
      </nav>
      <div class="nav-section-label section-gap">管理</div><nav aria-label="管理导航"><button v-for="id in (['tasks', 'logs'] as PageId[])" :key="id" class="nav-item" :class="{ active: studio.activeTab === id }" @click="studio.openTab(id)"><component :is="icons[id]" :size="18" /><span>{{ titles[id] }}</span><span v-if="id === 'tasks' && studio.taskActive" class="running-dot" /></button><button class="nav-item planned" disabled title="数据管理尚未实现"><Database :size="18" /><span>数据管理</span><small>规划</small></button></nav>
      <div class="sidebar-bottom"><div class="environment-card"><FlaskConical :size="17" /><div><strong>模拟环境</strong><span>未启用真实硬件访问</span></div></div><button class="nav-item" :class="{ active: studio.activeTab === 'about' }" @click="studio.openTab('about')"><CircleHelp :size="18" /><span>关于与使用说明</span></button></div>
    </aside>
    <button class="sidebar-edge-toggle" :class="{ collapsed: !studio.sidebarVisible }" :style="sidebarToggleTop === undefined ? undefined : { '--sidebar-toggle-y': `${sidebarToggleTop}px` }" :aria-label="studio.sidebarVisible ? '隐藏左侧导航' : '显示左侧导航'" :title="studio.sidebarVisible ? '收起左侧导航' : '展开左侧导航'" :aria-expanded="studio.sidebarVisible" aria-controls="primary-sidebar" @pointerenter="positionSidebarToggle" @pointermove="positionSidebarToggle" @click="studio.toggleSidebar"><span class="sidebar-toggle-handle" aria-hidden="true"><ChevronLeft v-if="studio.sidebarVisible" :size="18" /><ChevronRight v-else :size="18" /></span></button>

    <main class="workspace"><header class="topbar"><div class="topbar-left"><div class="breadcrumb"><span>工作区</span><ChevronRight :size="13" /><strong>{{ titles[studio.activeTab] }}</strong></div></div><div class="topbar-right"><span class="kernel-status" :class="{ connected: studio.online }"><i />{{ studio.online ? '内核已连接' : studio.initializing ? '正在启动内核…' : '内核离线 · 自动重连中' }}</span><span class="header-divider" /><button class="icon-button" aria-label="切换明暗主题" @click="studio.toggleTheme"><Moon v-if="studio.theme === 'light'" :size="17" /><Sun v-else :size="17" /></button><button class="icon-button" aria-label="切换底部日志" :aria-pressed="studio.logPanel" @click="studio.logPanel = !studio.logPanel"><PanelBottom :size="17" /></button></div></header>

      <div class="tabbar" role="tablist" aria-label="工作台标签"><div v-for="id in studio.tabs" :key="id" class="workspace-tab" :class="{ active: studio.activeTab === id }"><button role="tab" :aria-selected="studio.activeTab === id" :aria-controls="'panel-' + id" @click="studio.activeTab = id"><component :is="icons[id]" :size="14" />{{ titles[id] }}</button><button class="tab-close" :aria-label="`关闭 ${titles[id]} 标签`" @click="studio.closeTab(id)"><X :size="13" /></button></div><span class="tabbar-fill" /><span class="tabbar-hint"><Command :size="12" />本地工作台</span></div>

      <div v-if="!studio.online && !studio.initializing" class="offline-banner">内核暂不可用。界面保持打开，正在尝试恢复会话。若尚未启动服务，请运行 npm run dev 或桌面启动入口。</div>
      <div ref="workspaceElement" :id="'panel-' + studio.activeTab" class="workspace-content" role="tabpanel">
        <component :is="activeView" v-if="activeView" :key="studio.activeTab" />
        <div v-if="studio.activeTab === 'logs'" class="page full-log-page"><div class="page-heading"><div><div class="eyebrow">WORKSPACE / LOGS</div><h1>日志中心</h1><p>设备、任务与寄存器操作，在同一时间线上。</p></div></div><div class="panel log-full-panel"><LogView /></div></div>
        <div v-if="studio.activeTab === 'about'" class="page about-page"><div class="eyebrow">TESTSTUDIO / ABOUT</div><h1>为芯片调试而构建。</h1><p class="about-lead">连接一次，自由切换工作台。让设备控制、波形分析和测试流程各就其位。</p><div class="about-grid"><section class="panel"><Activity :size="29" /><h2>TestStudio <span class="badge">0.1.0 原型</span></h2><p>Electron + Vue / TypeScript + Python 独立内核。当前版本提供模拟连接中心、寄存器工作台和日志。</p><p class="muted">IQ、LA、BLE、WiFi 和测试数据管理仍在规划中；本版本不操作真实硬件。</p></section><section class="panel"><CheckCircle2 :size="26" /><h2>开始使用</h2><ol><li>在连接中心连接模拟 DUT。</li><li>打开寄存器工作台，点击“读取全部”。</li><li>点击可写 bit 或编辑待写值，显式写入并检查校验。</li><li>在底部日志或日志中心查看操作记录。</li></ol></section></div></div>
      </div>

      <div v-if="studio.taskActive" class="running-task-bar"><Activity :size="15" class="pulse" /><button @click="studio.openTab('tasks')">{{ studio.snapshot?.task?.name }}</button><div class="mini-progress"><i :style="{ width: `${(studio.snapshot?.task?.progress ?? 0) * 100}%` }" /></div><span>{{ Math.round((studio.snapshot?.task?.progress ?? 0) * 100) }}%</span><button class="icon-button" aria-label="停止当前任务" :disabled="studio.busy" @click="studio.cancelTask"><Square :size="13" /></button></div>
      <section v-if="studio.logPanel && studio.activeTab !== 'logs'" class="bottom-panel"><header><div><span class="panel-active-label">输出日志</span><span class="muted">{{ studio.snapshot?.logs.length ?? 0 }}</span></div><div><button class="icon-button" aria-label="在新标签打开日志" @click="studio.openTab('logs')"><ExternalLink :size="14" /></button><button class="icon-button" aria-label="关闭底部日志" @click="studio.logPanel = false"><X :size="15" /></button></div></header><LogView compact /></section>
      <footer class="statusbar"><span><Circle :size="8" fill="currentColor" />模拟环境</span><span>{{ onlineCount }} 个共享连接</span><span>{{ studio.taskActive ? '任务运行中' : '无运行任务' }}</span><span class="status-spacer" /><span>Python 内核</span><span>UTF-8</span><span>v0.1.0</span></footer>
    </main>

    <Transition name="toast"><div v-if="studio.notification" class="toast" :class="{ error: studio.notification.error }" role="status"><span>{{ studio.notification.text }}</span><button class="icon-button" aria-label="关闭提示" @click="studio.notification = null"><X :size="14" /></button></div></Transition>
  </div>
</template>
