import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { request } from '../api'
import type { BitField, Connection, PageId, RegisterCatalog, RegisterDefinition, RegisterReadResult, RegisterState, RegisterWriteResult, Snapshot } from '../types'

export const hex = (value: number) => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
export const fieldMask = (msb: number, lsb: number) => ((2 ** (msb - lsb + 1) - 1) * 2 ** lsb) >>> 0
export const SELF_CLEAR_ACCESS: BitField['access'][] = ['WC', 'W1_PULSE', 'WC_INT']
export const accessMask = (register: RegisterDefinition, ...accesses: BitField['access'][]) =>
  register.fields.reduce((mask, field) => accesses.includes(field.access) ? (mask | fieldMask(field.msb, field.lsb)) >>> 0 : mask, 0)
export function readableMask(register: RegisterDefinition) {
  const wo = accessMask(register, 'WO')
  if (wo && register.fields.every(field => ['WO', 'Reserved'].includes(field.access))) return 0
  return (~wo) >>> 0
}
export function maskedHex(value: number, mask: number) {
  return `0x${Array.from({ length: 8 }, (_, index) => {
    const shift = (7 - index) * 4
    return ((mask >>> shift) & 15) === 15 ? ((value >>> shift) & 15).toString(16).toUpperCase() : '?'
  }).join('')}`
}

interface PendingOperation {
  key?: string
  connectionId?: string
  label?: string
}

export const useStudio = defineStore('studio', () => {
  const snapshot = ref<Snapshot | null>(null)
  const online = ref(false)
  const initializing = ref(true)
  const pending = ref<Record<string, PendingOperation>>({})
  const busy = computed(() => !!pending.value.workspace)
  const notification = ref<{ text: string; error: boolean } | null>(null)
  const definitions = ref<RegisterDefinition[]>([])
  const definitionByAddress = computed(() => new Map(definitions.value.map(register => [register.address, register])))
  const writeOnlyDefinitions = computed(() => definitions.value.filter(register => !readableMask(register)))
  const catalogRevision = ref(0)
  const values = ref<Record<string, RegisterState>>({})
  const selectedDevice = ref('')
  const tabs = ref<PageId[]>(['connections'])
  const activeTab = ref<PageId>('connections')
  const logPanel = ref(true)
  const sidebarVisible = ref(localStorage.getItem('teststudio.sidebar') !== 'hidden')
  const theme = ref(localStorage.getItem('teststudio.theme') ?? 'light')
  const connections = computed(() => snapshot.value?.connections ?? [])
  const socs = computed(() => connections.value.filter(item => item.kind === 'soc'))
  const device = computed(() => connections.value.find(item => item.id === selectedDevice.value))
  const taskActive = computed(() => ['running', 'cancelling'].includes(snapshot.value?.task?.status ?? ''))
  const canOperate = computed(() => online.value && !busy.value && !taskActive.value &&
    device.value?.status === 'connected' && !connectionPending(device.value.id))
  let socket: WebSocket | null = null
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let starting = false
  let loadingCatalog: Promise<void> | undefined
  let catalogInstance = ''

  function apply(snapshotValue: Snapshot) {
    // 不同设备请求可并发，较早的 HTTP 快照不能覆盖更新的事件状态。
    if (snapshot.value?.started_at === snapshotValue.started_at && snapshotValue.revision <= snapshot.value.revision) return
    snapshot.value = snapshotValue
    if (!starting && (catalogRevision.value !== snapshotValue.register_revision || catalogInstance !== snapshotValue.started_at)) {
      void loadCatalog().catch(error => notify(error instanceof Error ? error.message : '寄存器表加载失败', true))
    }
    if (!snapshotValue.connections.some(item => item.id === selectedDevice.value && item.kind === 'soc')) {
      selectedDevice.value = snapshotValue.connections.find(item => item.kind === 'soc')?.id ?? ''
    }
    const sessions = new Set(snapshotValue.connections.map(item => item.session_id))
    for (const [key, value] of Object.entries(values.value)) {
      if (!sessions.has(value.session)) delete values.value[key]
    }
    initializeWriteOnlyStates()
  }

  function notify(text: string, error = false) {
    notification.value = { text, error }
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notification.value = null }, 5500)
  }

  async function loadCatalog() {
    if (loadingCatalog) return loadingCatalog
    loadingCatalog = (async () => {
      do {
        const instance = snapshot.value?.started_at ?? ''
        const catalog = await request<RegisterCatalog>('/registers/definitions')
        if (disposed) return
        if (catalogRevision.value !== catalog.revision || catalogInstance !== instance) values.value = {}
        definitions.value = catalog.registers
        catalogRevision.value = catalog.revision
        catalogInstance = instance
        initializeWriteOnlyStates()
      } while (snapshot.value && (catalogRevision.value < snapshot.value.register_revision || catalogInstance !== snapshot.value.started_at))
    })().finally(() => { loadingCatalog = undefined })
    return loadingCatalog
  }

  async function refresh() {
    apply(await request<Snapshot>('/state'))
    if (catalogRevision.value !== snapshot.value?.register_revision || catalogInstance !== snapshot.value?.started_at) await loadCatalog()
  }

  function isPending(key: string) { return !!pending.value[key] }
  function connectionPending(id: string) {
    return Object.values(pending.value).some(operation => operation.connectionId === id)
  }
  function connectionOperation(id: string) {
    return Object.values(pending.value).find(operation => operation.connectionId === id)?.label
  }

  async function run<T>(action: () => Promise<T>, success?: string, options: PendingOperation = {}): Promise<T | undefined> {
    const key = options.key ?? 'workspace'
    if (isPending(key) || (options.connectionId && connectionPending(options.connectionId))) return undefined
    pending.value[key] = options
    try {
      const result = await action()
      await refresh()
      if (success) notify(success)
      return result
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作失败', true)
      return undefined
    } finally { delete pending.value[key] }
  }

  async function initialize() {
    if (disposed || starting) return
    starting = true
    clearTimeout(reconnect)
    try {
      apply(await request<Snapshot>('/bootstrap', 'POST'))
      await loadCatalog()
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${location.host}/api/events`)
      socket.onopen = () => { online.value = true }
      socket.onmessage = event => { apply(JSON.parse(event.data) as Snapshot) }
      socket.onclose = () => {
        online.value = false
        if (!disposed) reconnect = setTimeout(initialize, 1800)
      }
      socket.onerror = () => { online.value = false }
    } catch {
      online.value = false
      if (!disposed) reconnect = setTimeout(initialize, 2500)
    } finally {
      starting = false
      initializing.value = false
    }
  }

  function dispose() {
    disposed = true
    clearTimeout(reconnect)
    clearTimeout(noticeTimer)
    socket?.close()
  }

  function openTab(id: PageId) {
    if (!tabs.value.includes(id)) tabs.value.push(id)
    activeTab.value = id
  }

  function closeTab(id: PageId) {
    const index = tabs.value.indexOf(id)
    tabs.value = tabs.value.filter(item => item !== id)
    if (!tabs.value.length) tabs.value.push('connections')
    if (activeTab.value === id) activeTab.value = tabs.value[Math.max(0, index - 1)] ?? 'connections'
  }

  function openDevice(connection: Connection) {
    selectedDevice.value = connection.id
    openTab('registers')
  }

  const valueKey = (address: string) => `${selectedDevice.value}:${address}`
  function stateFor(address: string) { return values.value[valueKey(address)] }

  function defaultDraft(register: RegisterDefinition, value: number | null) {
    return ((value ?? 0) & ~accessMask(register, 'W1C', 'WO', ...SELF_CLEAR_ACCESS)) >>> 0
  }

  function initializeWriteOnlyStates() {
    for (const connection of socs.value) {
      if (!connection.session_id) continue
      for (const register of writeOnlyDefinitions.value) {
        const key = `${connection.id}:${register.address}`
        if (!values.value[key]) {
          values.value[key] = { session: connection.session_id, actual: null, draft: 0, mask: 0, verified: null, unverifiedMask: 0 }
        }
      }
    }
  }

  function acceptRead(address: string, value: number | null, connection = device.value) {
    if (!connection?.session_id) return
    const definition = definitionByAddress.value.get(address)
    if (!definition) return
    const actual = value === null ? null : (value & readableMask(definition)) >>> 0
    values.value[`${connection.id}:${address}`] = {
      session: connection.session_id, actual, draft: defaultDraft(definition, actual), mask: 0, verified: null, unverifiedMask: 0,
    }
  }

  function writableMask(register: RegisterDefinition) {
    return accessMask(register, 'RW', 'W1C', 'WO', ...SELF_CLEAR_ACCESS)
  }

  function edit(register: RegisterDefinition, value: number, mask: number) {
    const state = stateFor(register.address)
    if (!state || !canOperate.value) return
    const allowed = (mask & writableMask(register)) >>> 0
    state.draft = ((state.draft & ~allowed) | (value & allowed)) >>> 0
    // RW 提交变化位，W1C/WC 只提交显式的 1；WO 提交完整编辑字段，允许写 0 和重复命令。
    let changed = 0
    for (const field of register.fields) {
      const bits = fieldMask(field.msb, field.lsb)
      if (field.access === 'RW') changed |= (state.draft ^ (state.actual ?? 0)) & bits
      if (field.access === 'W1C' || SELF_CLEAR_ACCESS.includes(field.access)) changed |= state.draft & bits
      if (field.access === 'WO' && ((allowed | state.mask) & bits)) changed |= bits
    }
    state.mask = changed >>> 0
    state.verified = null
    state.unverifiedMask = 0
  }

  function discardChanges(register: RegisterDefinition) {
    const state = stateFor(register.address)
    if (!state || !canOperate.value) return
    state.draft = defaultDraft(register, state.actual)
    state.mask = 0
    state.verified = null
    state.unverifiedMask = 0
  }

  async function readAll() {
    const connection = device.value
    if (!connection) return
    await run(async () => {
      const result = await request<RegisterReadResult[]>(`/connections/${connection.id}/registers`)
      result.forEach(item => acceptRead(item.address, item.value, connection))
    }, '模拟可读寄存器已读取；WO 只写位不作为有效读回值', { connectionId: connection.id, label: '寄存器读取中' })
  }

  async function readOne(register: RegisterDefinition) {
    const connection = device.value
    if (!connection) return
    await run(async () => {
      const result = await request<RegisterReadResult>(`/connections/${connection.id}/registers/${register.address}`)
      acceptRead(result.address, result.value, connection)
    }, undefined, { connectionId: connection.id, label: '寄存器读取中' })
  }

  async function writeOne(register: RegisterDefinition) {
    const state = stateFor(register.address)
    const connection = device.value
    if (!state?.mask || !connection) return
    await run(async () => {
      const result = await request<RegisterWriteResult>(`/connections/${connection.id}/registers/write`, 'POST', {
        address: register.address, value: state.draft, mask: state.mask,
      })
      acceptRead(result.address, result.value, connection)
      const updated = values.value[`${connection.id}:${register.address}`]!
      updated.verified = result.verified
      updated.unverifiedMask = result.unverified_mask
      if (result.verified === false) throw new Error('可读位与期望不符，校验失败')
      const unchecked = []
      if (result.unverified_mask & accessMask(register, 'WO')) unchecked.push('WO 只写位')
      if (result.unverified_mask & accessMask(register, ...SELF_CLEAR_ACCESS)) unchecked.push('自清零位')
      notify(`${register.name} 模拟写入已提交${result.verified ? '，可读位校验通过' : ''}${unchecked.length ? `；${unchecked.join('、')}未校验` : ''}`)
    }, undefined, { connectionId: connection.id, label: '寄存器写入中' })
  }

  async function cancelTask() { await run(() => request('/tasks/cancel', 'POST')) }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    localStorage.setItem('teststudio.theme', theme.value)
  }

  function toggleSidebar() {
    sidebarVisible.value = !sidebarVisible.value
    localStorage.setItem('teststudio.sidebar', sidebarVisible.value ? 'visible' : 'hidden')
  }

  return { snapshot, online, initializing, busy, notification, definitions, catalogRevision, values, selectedDevice, tabs, activeTab,
    logPanel, sidebarVisible, theme, connections, socs, device, taskActive, canOperate, initialize, dispose, run, refresh, notify,
    openTab, closeTab, openDevice, stateFor, writableMask, edit, discardChanges, readAll, readOne, writeOne, cancelTask, toggleTheme, toggleSidebar,
    isPending, connectionPending, connectionOperation }
})
