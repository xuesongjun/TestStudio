<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshCw, Search, ArrowDownToLine, LockKeyhole, SlidersHorizontal, Info, Download as ImportIcon, Upload as ExportIcon, Trash2, X } from '@lucide/vue'
import RegisterRow from '../components/RegisterRow.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { request } from '../api'
import { useStudio, hex, readableMask, SELF_CLEAR_ACCESS } from '../stores/studio'
import type { RegisterPreview, RegisterSheet } from '../types'

const studio = useStudio()
const query = ref('')
const group = ref('ALL')
const selectedAddress = ref('0x00001000')
const pageElement = ref<HTMLElement>()
const inspectorElement = ref<HTMLElement>()
const inspectorMaxHeight = ref(0)
const tableElement = ref<HTMLElement>()
const tableHeight = ref(336)
const tableScrollTop = ref(0)
const rowHeight = ref(144)
const stackedRows = ref(true)
const checked = ref<string[]>([])
const deleting = ref<string[] | null>(null)
const deleteRevision = ref(0)
const fileInput = ref<HTMLInputElement>()
const importPreview = ref<RegisterPreview | null>(null)
const importName = ref('')
const importMode = ref<'append' | 'replace'>('append')
const previewing = ref(false)
const pendingFile = ref<File | null>(null)
const availableSheets = ref<RegisterSheet[]>([])
const selectedSheets = ref<string[]>([])
const importableSheets = computed(() => availableSheets.value.filter(sheet => sheet.format !== 'unsupported'))
const selectedSheetCount = computed(() => importableSheets.value.filter(sheet => selectedSheets.value.includes(sheet.name)).length)
const allSheetsSelected = computed(() => importableSheets.value.length > 0 && selectedSheetCount.value === importableSheets.value.length)
const someSheetsSelected = computed(() => selectedSheetCount.value > 0 && !allSheetsSelected.value)
const canManage = computed(() => studio.online && !studio.busy && !studio.taskActive && !previewing.value)
let workspaceObserver: ResizeObserver | undefined
let scrollFrame = 0
let layoutFrame = 0
let updateLayout = () => {}
let removeWorkspaceScroll = () => {}
const HEADER_HEIGHT = 43
const OVERSCAN = 5
const groups = computed(() => {
  const counts = new Map<string, number>()
  for (const register of studio.definitions) counts.set(register.group, (counts.get(register.group) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count }))
})
const registers = computed(() => studio.definitions.filter(item =>
  (group.value === 'ALL' || item.group === group.value) &&
  `${item.name} ${item.address} ${item.description}`.toLowerCase().includes(query.value.toLowerCase())))
const selected = computed(() => studio.definitions.find(item => item.address === selectedAddress.value))
const inspectorFields = computed(() => selected.value?.fields.filter(field => field.access !== 'Reserved' &&
  !(field.access === 'RO' && /reserved|保留/i.test(field.name))) ?? [])
const inspectorDescription = computed(() => {
  const description = selected.value?.description.trim() ?? ''
  return description !== selected.value?.name.trim() ? description : ''
})
const dirtyCount = computed(() => studio.definitions.filter(item => studio.stateFor(item.address)?.mask).length)
const hasReadableRegisters = computed(() => studio.definitions.some(item => readableMask(item)))
const checkedSet = computed(() => new Set(checked.value))
const allChecked = computed(() => registers.value.length > 0 && registers.value.every(item => checkedSet.value.has(item.address)))
const someChecked = computed(() => !allChecked.value && registers.value.some(item => checkedSet.value.has(item.address)))
const importConflicts = computed(() => importPreview.value?.registers.filter(item => studio.definitions.some(existing => existing.address === item.address)) ?? [])
const virtualized = computed(() => registers.value.length > 40)
const firstVisible = computed(() => virtualized.value ? Math.max(0, Math.min(registers.value.length - 1,
  Math.floor(Math.max(0, tableScrollTop.value - HEADER_HEIGHT) / rowHeight.value)) - OVERSCAN) : 0)
const lastVisible = computed(() => virtualized.value ? Math.min(registers.value.length,
  firstVisible.value + Math.ceil(tableHeight.value / rowHeight.value) + OVERSCAN * 2 + 1) : registers.value.length)
const visibleRegisters = computed(() => registers.value.slice(firstVisible.value, lastVisible.value))
const topSpacer = computed(() => firstVisible.value * rowHeight.value)
const bottomSpacer = computed(() => (registers.value.length - lastVisible.value) * rowHeight.value)

function onTableScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    tableScrollTop.value = tableElement.value?.scrollTop ?? 0
    scrollFrame = 0
  })
}

function checkRegister(address: string, selectedValue: boolean) {
  checked.value = selectedValue ? [...new Set([...checked.value, address])] : checked.value.filter(item => item !== address)
}

watch([group, query, () => studio.catalogRevision], () => {
  tableScrollTop.value = 0
  if (tableElement.value) tableElement.value.scrollTop = 0
}, { flush: 'sync' })
watch([() => studio.device?.status, () => studio.taskActive], () => nextTick(() => updateLayout()))

watch(() => studio.catalogRevision, () => {
  checked.value = checked.value.filter(address => studio.definitions.some(item => item.address === address))
  if (!studio.definitions.some(item => item.address === selectedAddress.value)) selectedAddress.value = studio.definitions[0]?.address ?? ''
  if (group.value !== 'ALL' && !groups.value.some(item => item.name === group.value)) group.value = 'ALL'
})

function toggleAll(checkedValue: boolean) {
  const visible = new Set(registers.value.map(item => item.address))
  checked.value = checkedValue ? [...new Set([...checked.value, ...visible])] : checked.value.filter(address => !visible.has(address))
}

function toggleAllSheets(checkedValue: boolean) {
  selectedSheets.value = checkedValue ? importableSheets.value.map(sheet => sheet.name) : []
}

function askDelete(addresses: string[]) {
  deleting.value = [...addresses]
  deleteRevision.value = studio.catalogRevision
}

async function deleteRegisters() {
  if (!deleting.value?.length) return
  const addresses = [...deleting.value]
  const result = await studio.run(() => request('/registers/delete', 'POST', {
    addresses, expected_revision: deleteRevision.value,
  }), `已删除 ${addresses.length} 个寄存器配置，未写入设备`)
  if (result) deleting.value = null
}

async function previewFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 8 * 1024 * 1024) { studio.notify('文件超过 8 MB，请拆分后导入', true); return }
  previewing.value = true
  try {
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const result = await request<{ sheets: RegisterSheet[] }>('/registers/sheets', 'POST', file)
      pendingFile.value = file
      availableSheets.value = result.sheets
      toggleAllSheets(true)
    } else {
      importPreview.value = await request<RegisterPreview>(`/registers/preview?filename=${encodeURIComponent(file.name)}`, 'POST', file)
    }
    importName.value = file.name
    importMode.value = 'append'
  } catch (error) {
    studio.notify(error instanceof Error ? error.message : '导入文件解析失败', true)
  } finally { previewing.value = false }
}

async function previewSheets() {
  const file = pendingFile.value
  if (!file || !selectedSheets.value.length) return
  previewing.value = true
  try {
    const params = new URLSearchParams({ filename: file.name })
    selectedSheets.value.forEach(name => params.append('sheets', name))
    importPreview.value = await request<RegisterPreview>(`/registers/preview?${params}`, 'POST', file)
    pendingFile.value = null
    importMode.value = 'append'
  } catch (error) {
    studio.notify(error instanceof Error ? error.message : '工作表解析失败', true)
  } finally { previewing.value = false }
}

async function importRegisters() {
  if (!importPreview.value) return
  const preview = importPreview.value
  const result = await studio.run(() => request('/registers/import', 'POST', {
    mode: importMode.value, expected_revision: preview.expected_revision, registers: preview.registers,
  }), `已导入 ${preview.count} 个寄存器定义，未向设备写入`)
  if (result) { importPreview.value = null; checked.value = []; group.value = 'ALL' }
}

function exportRegisters() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, registers: studio.definitions }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'teststudio-registers.json'
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  const workspace = pageElement.value?.closest('.workspace-content')
  if (!workspace) return
  // 同时预留吸顶间距与页面底部留白，滚到表格末尾也不会把详情顶端推到栏下。
  const resize = () => {
    const workspaceBounds = workspace.getBoundingClientRect()
    const inspectorTop = inspectorElement.value?.getBoundingClientRect().top ?? workspaceBounds.top + 12
    inspectorMaxHeight.value = Math.max(96, workspaceBounds.bottom - Math.max(workspaceBounds.top + 12, inspectorTop) - 12)
    const table = tableElement.value
    const page = pageElement.value
    if (table && page) {
      const footerHeight = (page.querySelector('.table-footer')?.clientHeight ?? 0) +
        (page.querySelector('.register-import-help')?.clientHeight ?? 0)
      // 使用页内偏移，不受工作区当前滚动位置影响；小窗口保留至少两行。
      const tableOffset = table.getBoundingClientRect().top - page.getBoundingClientRect().top
      tableHeight.value = Math.max(224, Math.min(672, workspace.clientHeight - tableOffset - footerHeight - 24))
      const stacked = table.clientWidth < 1120
      const nextHeight = stacked ? 144 : 112
      if (nextHeight !== rowHeight.value) {
        const row = Math.floor(Math.max(0, table.scrollTop - HEADER_HEIGHT) / rowHeight.value)
        rowHeight.value = nextHeight
        if (table.scrollTop) nextTick(() => {
          if (tableElement.value) tableElement.value.scrollTop = HEADER_HEIGHT + row * nextHeight
          onTableScroll()
        })
      }
      stackedRows.value = stacked
    }
  }
  updateLayout = resize
  const onWorkspaceScroll = () => {
    if (layoutFrame) return
    layoutFrame = requestAnimationFrame(() => { resize(); layoutFrame = 0 })
  }
  workspace.addEventListener('scroll', onWorkspaceScroll, { passive: true })
  removeWorkspaceScroll = () => workspace.removeEventListener('scroll', onWorkspaceScroll)
  resize()
  // 日志面板、任务栏和窗口尺寸变化时，详情始终限制在实际工作区内。
  workspaceObserver = new ResizeObserver(onWorkspaceScroll)
  workspaceObserver.observe(workspace)
  for (const element of pageElement.value?.querySelectorAll('.page-heading, .register-toolbar, .register-filters, .table-footer, .register-import-help') ?? []) {
    workspaceObserver.observe(element)
  }
  if (tableElement.value) workspaceObserver.observe(tableElement.value)
})
onUnmounted(() => {
  workspaceObserver?.disconnect()
  cancelAnimationFrame(scrollFrame)
  cancelAnimationFrame(layoutFrame)
  removeWorkspaceScroll()
})
watch(selectedAddress, async () => {
  await nextTick()
  // 换寄存器后从详情标题开始显示，不改变左侧表格的滚动位置。
  inspectorElement.value?.scrollTo({ top: 0 })
  updateLayout()
})

</script>

<template>
  <div ref="pageElement" class="page register-page" :style="inspectorMaxHeight ? { '--inspector-max-height': `${inspectorMaxHeight}px` } : undefined">
    <div class="page-heading"><div><div class="eyebrow">DEBUG / REGISTER WORKBENCH</div><h1>寄存器工作台</h1><p>查看每一个 bit，明确每一次修改。</p></div><span class="badge amber">模拟寄存器 · 32 BIT</span></div>
    <div class="register-toolbar">
      <div class="device-select"><span class="muted">目标设备</span><select v-model="studio.selectedDevice" aria-label="目标设备"><option v-for="device in studio.socs" :key="device.id" :value="device.id">{{ device.name }} · {{ device.status === 'connected' ? '已连接' : '未连接' }}</option></select></div>
      <span class="session-label" v-if="studio.device?.session_id">共享会话 <code>{{ studio.device.session_id.slice(0, 8) }}</code></span>
      <div class="toolbar-spacer" />
      <button class="button" :disabled="!canManage" @click="fileInput?.click()"><ImportIcon :size="15" />{{ previewing ? '解析中…' : '导入寄存器表' }}</button>
      <input ref="fileInput" type="file" class="visually-hidden" accept=".xlsx,.json" aria-label="寄存器表文件" @change="previewFile" />
      <button class="button" :disabled="!studio.definitions.length" @click="exportRegisters"><ExportIcon :size="15" />导出配置</button>
      <button v-if="checked.length" class="button danger" :disabled="!canManage" @click="askDelete(checked)"><Trash2 :size="15" />删除选中 {{ checked.length }}</button>
      <button class="button primary" :disabled="!studio.canOperate || !hasReadableRegisters" @click="studio.readAll"><RefreshCw :size="15" />读取全部</button>
    </div>
    <div v-if="studio.device?.status !== 'connected'" class="inline-notice"><Info :size="17" />当前设备尚未连接。请先到连接中心建立共享会话。<button class="text-button" @click="studio.openTab('connections')">打开连接中心 →</button></div>
    <div v-else-if="studio.taskActive" class="inline-notice"><LockKeyhole :size="17" />硬件任务正在执行，寄存器读写暂时锁定。切换标签不会中断任务。<button class="text-button" @click="studio.openTab('tasks')">查看任务 →</button></div>
    <div class="register-layout">
      <section class="register-main panel">
        <div class="register-filters"><label class="register-group-picker"><span>寄存器表</span><select v-model="group" aria-label="选择寄存器表"><option value="ALL">全部寄存器（{{ studio.definitions.length }}）</option><option v-for="item in groups" :key="item.name" :value="item.name">{{ item.name }}（{{ item.count }}）</option></select></label><span class="register-filter-count">{{ registers.length }} 个寄存器</span><div class="search-input"><Search :size="14" /><input v-model="query" aria-label="搜索寄存器" placeholder="名称或地址…" /></div></div>
        <div ref="tableElement" class="register-table-scroll" :class="{ 'stacked-registers': stackedRows }" role="region" aria-label="寄存器表格，纵向滚动" tabindex="0" :style="{ height: `${tableHeight}px`, '--register-row-height': `${rowHeight}px` }" @scroll.passive="onTableScroll">
          <table class="register-table" :aria-rowcount="registers.length + 1"><thead><tr><th><input type="checkbox" class="register-checkbox" :checked="allChecked" :indeterminate="someChecked" :disabled="!canManage" aria-label="全选当前筛选寄存器" @change="toggleAll(($event.target as HTMLInputElement).checked)" />寄存器 / 地址</th><th>读回值 / 待写值</th><th><span>32 BIT 位视图</span><span class="bit-legend"><i />可编辑<LockKeyhole :size="11" />只读 / 保留</span></th><th>操作</th></tr></thead>
            <tbody><tr v-if="topSpacer" class="virtual-spacer" aria-hidden="true"><td colspan="4" :style="{ height: `${topSpacer}px` }" /></tr>
              <RegisterRow v-for="(register, index) in visibleRegisters" :key="register.address" :register="register" :selected="selectedAddress === register.address" :checked="checkedSet.has(register.address)" :can-manage="canManage" :aria-rowindex="firstVisible + index + 2" @select="selectedAddress = register.address" @check="value => checkRegister(register.address, value)" @delete="askDelete([register.address])" />
              <tr v-if="bottomSpacer" class="virtual-spacer" aria-hidden="true"><td colspan="4" :style="{ height: `${bottomSpacer}px` }" /></tr>
            </tbody>
          </table>
          <div v-if="!registers.length" class="empty-small">{{ studio.definitions.length ? '没有匹配的寄存器' : '寄存器表为空，点击“导入寄存器表”加载 Excel 或 JSON。' }}</div>
        </div>
        <footer class="table-footer"><span>{{ registers.length }} 个寄存器 <b v-if="dirtyCount">· {{ dirtyCount }} 项待提交</b></span><span v-if="selected"><button class="text-button" :disabled="!studio.canOperate || !studio.stateFor(selected.address) || !studio.writableMask(selected)" @click="studio.edit(selected, 0, studio.writableMask(selected))">选中行全 0</button><button class="text-button" :disabled="!studio.canOperate || !studio.stateFor(selected.address) || !studio.writableMask(selected)" @click="studio.edit(selected, 0xFFFFFFFF, studio.writableMask(selected))">全 1</button></span><span>点击 bit 仅编辑，点击 <ArrowDownToLine :size="12" /> 才写入</span></footer>
        <div class="register-import-help"><a href="/api/registers/template" download>下载 Excel 模板</a><span>支持 v1/v2 .xlsx / .json，文件不超过 8 MB；仅修改工作台配置，不写入设备。</span></div>
      </section>

      <aside v-if="selected" ref="inspectorElement" class="field-inspector panel" aria-label="寄存器位域详情" tabindex="0"><div class="inspector-heading"><SlidersHorizontal :size="15" /><h2>位域详情</h2></div><h3>{{ selected.name }}</h3><code>{{ selected.address }}</code><p v-if="inspectorDescription" class="register-description">{{ inspectorDescription }}</p>
        <div class="field-list"><div v-for="field in inspectorFields" :key="field.msb" class="field-detail"><div><i :class="`field-dot-${field.color}`" /><strong>{{ field.name }}</strong><span class="access-tag" :class="field.access">{{ field.access }}</span></div><code>[{{ field.msb }}:{{ field.lsb }}]</code><p>{{ field.description }}</p><p v-if="field.reset !== null" class="field-initial-value">字段初始值：{{ hex(field.reset) }}</p><p v-if="field.access === 'WO'" class="field-initial-value">只写：显示待写值，按完整字段提交，无有效读回值，不参与校验。</p><p v-if="SELF_CLEAR_ACCESS.includes(field.access)" class="field-initial-value">写 1 后由硬件自动清 0，写 0 不触发；提交后不做值相等校验，不代表硬件动作完成。</p></div></div>
        <p v-if="!inspectorFields.length" class="empty-small">此寄存器仅含保留字段。</p>
        <div class="inspector-help"><Info :size="15" /><span>只读与保留位由内核保护。W1C 位的待写值为 1 时清零，0 时保持。</span></div>
      </aside>
    </div>
    <ConfirmDialog v-if="deleting" title="删除寄存器配置？" confirm-label="确认删除" :busy="studio.busy" @cancel="deleting = null" @confirm="deleteRegisters"><p>将从当前工作台永久移除 {{ deleting.length }} 个寄存器定义及其位域，所有模块共用的定义会同步更新。</p><p>不会清零、复位或写入芯片。未提交的编辑会随配置刷新清除，建议先导出配置。</p></ConfirmDialog>
    <div v-if="pendingFile" class="modal-backdrop" @click.self="!previewing && (pendingFile = null)"><form class="dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="sheet-select-title" @submit.prevent="previewSheets">
      <div class="dialog-heading"><h2 id="sheet-select-title">选择导入工作表</h2><button type="button" class="icon-button" aria-label="关闭工作表选择" :disabled="previewing" @click="pendingFile = null"><X :size="18" /></button></div><p>{{ pendingFile.name }} · 自动按表头识别 v1 / v2，不固定列序号。</p>
      <div class="sheet-selection-toolbar"><label class="sheet-select-all"><input type="checkbox" :checked="allSheetsSelected" :indeterminate="someSheetsSelected" :disabled="previewing || !importableSheets.length" aria-label="全选 / 全不选工作表" @change="toggleAllSheets(($event.target as HTMLInputElement).checked)" /><span>全选 / 全不选</span></label><span class="muted">已选 {{ selectedSheetCount }} / {{ importableSheets.length }} 个可导入工作表</span></div>
      <div class="sheet-selection"><label v-for="sheet in availableSheets" :key="sheet.name" class="sheet-option"><input v-model="selectedSheets" :value="sheet.name" type="checkbox" :disabled="previewing || sheet.format === 'unsupported'" :aria-label="`导入工作表 ${sheet.name}`" /><span>{{ sheet.name }}</span><span class="badge">{{ sheet.format === 'unsupported' ? '非寄存器表' : sheet.format }}</span></label></div>
      <p>v1/v2 的整字与字段初始值分别读取；“合并”和“DFT值”列将忽略。WC、W1_PULSE、WC_INT 均为写 1 后硬件自动清 0。</p>
      <div class="dialog-footer"><button type="button" class="button" :disabled="previewing" @click="pendingFile = null">取消</button><button class="button primary" :disabled="previewing || !selectedSheets.length">{{ previewing ? '解析中…' : '解析选中工作表' }}</button></div>
    </form></div>
    <div v-if="importPreview" class="modal-backdrop" @click.self="!studio.busy && (importPreview = null)"><form class="dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="register-import-title" @submit.prevent="importRegisters">
      <div class="dialog-heading"><h2 id="register-import-title">导入寄存器表预览</h2><button type="button" class="icon-button" aria-label="关闭导入预览" :disabled="studio.busy" @click="importPreview = null"><X :size="18" /></button></div>
      <p>{{ importName }} · {{ importPreview.count }} 个寄存器 · {{ importPreview.groups.join('、') }}</p>
      <div class="import-formats"><span v-for="(format, name) in importPreview.formats" :key="name" class="badge">{{ name }} · {{ format }}</span></div>
      <label>导入方式<select v-model="importMode" aria-label="寄存器导入方式" :disabled="studio.busy"><option value="append">追加到现有表（重复地址会拒绝）</option><option value="replace">替换整个工作台寄存器表</option></select></label>
      <p v-if="importMode === 'replace'" class="error-text">替换会移除现有 {{ studio.definitions.length }} 个定义及未提交编辑，建议先导出。不会向设备写入。</p>
      <p v-else-if="importConflicts.length" class="error-text">{{ importConflicts.length }} 个地址已存在，请检查文件或明确选择替换。</p>
      <div class="import-preview-scroll"><table class="simple-table"><thead><tr><th>分组</th><th>名称</th><th>地址</th><th>初始值</th></tr></thead><tbody><tr v-for="register in importPreview.registers.slice(0, 50)" :key="register.address"><td>{{ register.group }}</td><td>{{ register.name }}</td><td><code>{{ register.address }}</code></td><td><code>{{ hex(register.reset) }}</code></td></tr></tbody></table></div><p v-if="importPreview.count > 50">预览显示前 50 项，确认将导入全部 {{ importPreview.count }} 项。</p>
      <ul v-if="importPreview.warnings.length" class="import-warnings"><li v-for="warning in importPreview.warnings" :key="warning">{{ warning }}</li></ul>
      <p>支持 v1/v2 Excel（B2 基地址、第 4 行表头）或 JSON。缺失位域自动保留只读，初始值只是定义，不等于设备读回值。</p>
      <div class="dialog-footer"><a class="button" href="/api/registers/template" download>下载 Excel 模板</a><button type="button" class="button" :disabled="studio.busy" @click="importPreview = null">取消</button><button class="button primary" :disabled="!canManage || (importMode === 'append' && importConflicts.length > 0)">确认导入</button></div>
    </form></div>
  </div>
</template>
