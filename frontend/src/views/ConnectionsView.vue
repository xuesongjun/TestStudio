<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Plus, Cpu, Radio, PlugZap, Unplug, ArrowUpRight, Trash2, ShieldCheck, Network, X, Check, PencilLine, LoaderCircle, Cable, RefreshCw } from '@lucide/vue'
import { request } from '../api'
import { useStudio } from '../stores/studio'
import type { Connection, SerialPortInfo } from '../types'
import BaudRateInput from '../components/BaudRateInput.vue'

const studio = useStudio()
const creating = ref(false)
const name = ref('')
const kind = ref<'soc' | 'instrument'>('soc')
const mode = ref<'simulation' | 'hardware'>('simulation')
const editingId = ref('')
const port = ref('')
const baudrate = ref('115200')
const bytesize = ref<5 | 6 | 7 | 8>(8)
const parity = ref<'N' | 'E' | 'O' | 'M' | 'S'>('N')
const stopbits = ref<1 | 1.5 | 2>(1)
const ipAddress = ref('')
const deleteId = ref('')
const connected = computed(() => studio.connections.filter(item => item.status === 'connected').length)
const formKey = computed(() => editingId.value ? `connection:${editingId.value}` : 'connection:create')
const saving = computed(() => studio.isPending(formKey.value))
const serialPorts = ref<SerialPortInfo[]>([])
const scanning = ref(false)
const scanError = ref('')
const scanned = ref(false)
const unavailablePort = computed(() => !!port.value && scanned.value && !scanning.value && !scanError.value &&
  !serialPorts.value.some(item => item.device === port.value))
let scanRevision = 0

async function scanPorts() {
  if (scanning.value) return
  const revision = ++scanRevision
  scanning.value = true
  scanError.value = ''
  try {
    const result = await request<{ ports: SerialPortInfo[] }>('/serial/ports')
    if (revision !== scanRevision) return
    serialPorts.value = result.ports
    scanned.value = true
  } catch (error) {
    if (revision !== scanRevision) return
    scanError.value = error instanceof Error ? error.message : '串口扫描失败，请重试'
    serialPorts.value = []
    scanned.value = false
  } finally {
    if (revision === scanRevision) scanning.value = false
  }
}

watch([creating, kind], ([visible, type]) => {
  if (visible && type === 'soc') void scanPorts()
  else { scanRevision++; scanning.value = false }
})
onUnmounted(() => { scanRevision++ })

function openForm(connection?: Connection) {
  editingId.value = connection?.id ?? ''
  name.value = connection?.name ?? ''
  kind.value = connection?.kind ?? 'soc'
  mode.value = connection?.mode ?? 'simulation'
  port.value = connection?.serial?.port ?? ''
  baudrate.value = String(connection?.serial?.baudrate ?? 115200)
  bytesize.value = connection?.serial?.bytesize ?? 8
  parity.value = connection?.serial?.parity ?? 'N'
  stopbits.value = connection?.serial?.stopbits ?? 1
  ipAddress.value = connection?.instrument?.ip_address ?? ''
  creating.value = true
}

async function create() {
  const payload = {
    name: name.value.trim(), kind: kind.value, mode: mode.value,
    transport: kind.value === 'soc' ? 'serial' : 'tcpip',
    ...(kind.value === 'soc'
      ? { serial: { port: port.value.trim(), baudrate: Number(baudrate.value), bytesize: bytesize.value, parity: parity.value, stopbits: stopbits.value } }
      : { instrument: { ip_address: ipAddress.value.trim() || null, protocol: 'visa_tcpip' } }),
  }
  const result = await studio.run(() => request(editingId.value ? `/connections/${editingId.value}` : '/connections', editingId.value ? 'PUT' : 'POST', payload),
    '连接配置已保存', { key: formKey.value, connectionId: editingId.value || undefined, label: '保存配置中' })
  if (result) { creating.value = false; name.value = '' }
}

async function toggle(connection: Connection) {
  const action = connection.status === 'connected' ? 'disconnect' : 'connect'
  await studio.run(() => request(`/connections/${connection.id}/${action}`, 'POST'), undefined,
    { key: `connection:${connection.id}`, connectionId: connection.id, label: action === 'connect' ? '连接中' : '断开中' })
}

async function remove(connection: Connection) {
  await studio.run(() => request(`/connections/${connection.id}`, 'DELETE'), undefined,
    { key: `connection:${connection.id}`, connectionId: connection.id, label: '删除中' })
  deleteId.value = ''
}
</script>

<template>
  <div class="page connection-page">
    <div class="page-heading">
      <div><div class="eyebrow">WORKSPACE / CONNECTIONS</div><h1>连接中心</h1><p>在这里连接一次，让每个工作台共享设备。</p></div>
      <button class="button primary" :disabled="!studio.online" @click="openForm()"><Plus :size="16" />添加连接</button>
    </div>

    <div class="simulation-banner"><ShieldCheck :size="20" /><div><strong>设备走串口，仪表走 IP</strong><span>统一保存串口与仪表 IP 配置。当前仅启用模拟会话，真实驱动待接入，不会访问硬件。</span></div><span class="badge amber">模拟内核</span></div>

    <div class="summary-strip">
      <div><span class="metric-label">已配置设备</span><strong>{{ studio.connections.length }}<small>个</small></strong></div>
      <div><span class="metric-label">共享连接</span><strong class="teal-text">{{ connected }}<small>在线</small></strong></div>
      <div><span class="metric-label">硬件任务</span><strong>{{ studio.taskActive ? '运行中' : '空闲' }}<small>全局单任务</small></strong></div>
      <div class="metric-note"><Network :size="24" /><span>连接由 Python 内核持有<br />切换标签，不中断会话</span></div>
    </div>

    <div class="section-heading"><h2>设备与仪表 <span>{{ studio.connections.length }}</span></h2><span class="muted">配置自动保存在本机</span></div>
    <div class="connection-grid">
      <article v-for="connection in studio.connections" :key="connection.id" class="connection-card" :class="{ connected: connection.status === 'connected' }" :aria-label="`${connection.name} 连接卡片`">
        <div class="card-top"><div class="device-icon"><Cpu v-if="connection.kind === 'soc'" :size="23" /><Radio v-else :size="23" /></div>
          <span class="connection-status" :class="connection.status"><i />{{ connection.busy ? '任务占用中' : connection.status === 'connected' ? '模拟已连接' : '未连接' }}</span>
        </div>
        <h3>{{ connection.name }}</h3><p class="card-subtitle">{{ connection.kind === 'soc' ? 'SoC · 串口' : '仪表 · IP / VISA' }}<span>{{ connection.mode === 'simulation' ? '模拟模式' : '硬件配置 · 驱动待接入' }}</span></p>
        <dl>
          <template v-if="connection.kind === 'soc'"><div><dt>串口号</dt><dd>{{ connection.serial?.port || '未配置（模拟）' }}</dd></div><div><dt>串口参数</dt><dd>{{ connection.serial?.baudrate }} · {{ connection.serial?.bytesize }}{{ connection.serial?.parity }}{{ connection.serial?.stopbits }}</dd></div></template>
          <template v-else><div><dt>IP 地址</dt><dd>{{ connection.instrument?.ip_address || '未配置（模拟）' }}</dd></div><div><dt>通信驱动</dt><dd>VISA TCPIP</dd></div></template>
          <div><dt>会话</dt><dd>{{ connection.session_id?.slice(0, 8) ?? '尚未建立' }}</dd></div>
        </dl>
        <div class="card-actions"><button class="button connection-toggle" :class="{ primary: connection.status !== 'connected' }" :disabled="!studio.online || studio.connectionPending(connection.id) || connection.busy || connection.mode === 'hardware'" :aria-busy="studio.connectionPending(connection.id)" :aria-label="`${connection.status === 'connected' ? '断开' : '连接'} ${connection.name}`" :title="connection.mode === 'hardware' ? '真实驱动尚未接入，当前仅保存连接参数' : undefined" @click="toggle(connection)">
            <LoaderCircle v-if="studio.connectionPending(connection.id)" :size="15" class="spin" /><Unplug v-else-if="connection.status === 'connected'" :size="15" /><PlugZap v-else :size="15" />{{ studio.connectionOperation(connection.id) ?? (connection.mode === 'hardware' ? '驱动待接入' : connection.status === 'connected' ? '断开连接' : '模拟连接') }}
          </button>
          <button v-if="connection.kind === 'soc'" class="button ghost" @click="studio.openDevice(connection)">寄存器<ArrowUpRight :size="15" /></button>
          <button class="icon-button edit-connection" :disabled="!studio.online || connection.status === 'connected' || studio.connectionPending(connection.id)" :aria-label="`编辑 ${connection.name}`" title="断开后可修改串口或仪表 IP 配置" @click="openForm(connection)"><PencilLine :size="15" /></button>
          <button class="icon-button delete-connection" :disabled="!studio.online || connection.status === 'connected' || studio.connectionPending(connection.id)" :aria-label="`删除 ${connection.name}`" @click="deleteId = connection.id"><Trash2 :size="15" /></button>
        </div>
        <div v-if="deleteId === connection.id" class="delete-confirm"><span>删除此连接配置？</span><button class="button danger small" :disabled="!studio.online || studio.connectionPending(connection.id)" @click="remove(connection)">确认删除</button><button class="icon-button" aria-label="取消删除" @click="deleteId = ''"><X :size="14" /></button></div>
      </article>
      <button class="add-card" :disabled="!studio.online" @click="openForm()"><Plus :size="25" /><strong>配置新连接</strong><span>SoC 串口 / 仪表 IP</span></button>
    </div>

    <div class="onboarding"><div><span class="step-number">01</span><h3>建立共享连接</h3><p>选择一个模拟 SoC，点击连接设备。</p></div><div><span class="step-number">02</span><h3>打开寄存器工作台</h3><p>读取寄存器，检查位域和访问属性。</p></div><div><span class="step-number">03</span><h3>编辑、提交与校验</h3><p>修改 bit 后显式写入，在日志中追踪结果。</p></div></div>

    <div v-if="creating" class="modal-backdrop" @click.self="!saving && (creating = false)">
      <form class="dialog connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title" @submit.prevent="create"><div class="dialog-heading"><h2 id="connection-dialog-title">{{ editingId ? '编辑连接' : '添加连接' }}</h2><button type="button" class="icon-button" aria-label="关闭连接配置" :disabled="saving" @click="creating = false"><X :size="18" /></button></div>
        <p>芯片设备通过串口连接，仪表通过 IP / VISA 连接。配置由内核统一管理。</p>
        <fieldset :disabled="saving" class="connection-form-fields">
        <label>连接名称<input v-model="name" required maxlength="64" autofocus placeholder="例如 DUT-C" aria-label="连接名称" /></label>
        <label>设备类型<select v-model="kind" aria-label="设备类型"><option value="soc">SoC 调试设备</option><option value="instrument">射频仪表</option></select></label>
        <label>运行模式<select v-model="mode" aria-label="运行模式"><option value="simulation">模拟模式 · 不访问硬件</option><option value="hardware">真实硬件配置 · 仅保存，驱动待接入</option></select></label>
        <div class="connection-params"><h3><Cable v-if="kind === 'soc'" :size="16" /><Network v-else :size="16" />{{ kind === 'soc' ? '串口参数' : '仪表网络参数' }}</h3>
          <template v-if="kind === 'soc'"><div class="form-grid"><div class="form-field"><label for="serial-port">串口号</label><div class="serial-port-picker"><select id="serial-port" v-model="port" aria-label="串口号" :required="mode === 'hardware'" :aria-busy="scanning" @focus="scanPorts">
              <option value="">{{ scanning ? '正在扫描串口…' : '请选择串口' }}</option>
              <option v-if="port && !serialPorts.some(item => item.device === port)" :value="port">{{ port }}（{{ unavailablePort ? '未检测到' : '已保存' }}）</option>
              <option v-for="item in serialPorts" :key="item.device" :value="item.device">{{ item.device }} · {{ item.description }}</option>
            </select><button type="button" class="icon-button port-refresh" :disabled="scanning" aria-label="刷新串口列表" title="重新扫描系统串口，不打开端口" @click="scanPorts"><RefreshCw :size="16" :class="{ spin: scanning }" /></button></div></div>
            <div class="form-field"><label>波特率<BaudRateInput v-model="baudrate" :disabled="saving" /></label></div></div>
            <p v-if="scanError" class="port-hint error-text" role="status">{{ scanError }}</p>
            <p v-else-if="!scanning && scanned && !serialPorts.length" class="port-hint" role="status">未检测到串口，请连接设备后刷新。模拟模式可留空。</p>
            <p v-else-if="unavailablePort" class="port-hint" role="status">{{ port }} 当前未检测到，已保留原配置，未自动改选其他端口。</p>
            <p v-else class="port-hint">{{ scanning ? '正在枚举系统串口，不会打开任何端口。' : '自动扫描系统串口；设备插拔后可点击刷新。波特率可选预设或手动输入。' }}</p>
            <div class="form-grid serial-framing"><label>数据位<select v-model="bytesize" aria-label="数据位"><option v-for="value in [8, 7, 6, 5]" :key="value" :value="value">{{ value }}</option></select></label><label>校验位<select v-model="parity" aria-label="校验位"><option value="N">无 N</option><option value="E">偶 E</option><option value="O">奇 O</option><option value="M">标记 M</option><option value="S">空格 S</option></select></label><label>停止位<select v-model="stopbits" aria-label="停止位"><option :value="1">1</option><option :value="1.5">1.5</option><option :value="2">2</option></select></label></div>
          </template>
          <template v-else><label>IP 地址<input v-model="ipAddress" aria-label="IP 地址" :required="mode === 'hardware'" placeholder="例如 192.168.1.100" maxlength="15" inputmode="decimal" /></label><label>通信驱动<input value="VISA TCPIP" aria-label="通信驱动" readonly /></label></template>
          <p class="form-help">{{ mode === 'simulation' ? '地址可留空。即使填写串口或 IP，也只建立软件模拟会话，不会打开硬件连接。' : '真实驱动尚未接入：可保存并编辑参数，但不能连接。IP 并不等同于任意 TCP 端口，当前按 VISA TCPIP 规划。' }}</p>
        </div>
        </fieldset>
        <div class="dialog-footer"><button type="button" class="button" :disabled="saving" @click="creating = false">取消</button><button class="button primary" :disabled="!studio.online || !name.trim() || saving" :aria-busy="saving"><LoaderCircle v-if="saving" :size="15" class="spin" /><Check v-else :size="15" />{{ saving ? '保存中…' : '保存配置' }}</button></div>
      </form>
    </div>
  </div>
</template>
