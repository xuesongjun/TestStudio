<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { Search, Upload as ExportIcon, ArrowDownToLine, Pause, Trash2 } from '@lucide/vue'
import { useStudio } from '../stores/studio'
import { request } from '../api'
import ConfirmDialog from './ConfirmDialog.vue'

defineProps<{ compact?: boolean }>()
const studio = useStudio()
const query = ref('')
const level = ref('ALL')
const scroll = ref<HTMLElement>()
const follow = ref(true)
const confirmingClear = ref(false)
const clearing = computed(() => studio.isPending('logs:clear'))
async function clearLogs() {
  const result = await studio.run(() => request<{ deleted: number }>('/logs', 'DELETE'), '日志已清空', { key: 'logs:clear' })
  if (result) confirmingClear.value = false
}
const entries = computed(() => (studio.snapshot?.logs ?? []).filter(entry =>
  (level.value === 'ALL' || entry.level === level.value) &&
  `${entry.message} ${entry.source}`.toLowerCase().includes(query.value.toLowerCase())))
const time = (timestamp: string) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
watch([() => entries.value.at(-1)?.id, () => entries.value.length, follow], async () => {
  if (!follow.value) return
  await nextTick()
  scroll.value?.scrollTo({ top: scroll.value.scrollHeight })
}, { immediate: true, flush: 'post' })
function exportLogs() {
  const text = entries.value.map(entry => `${entry.timestamp}\t${entry.level}\t${entry.source}\t${entry.message}`).join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `teststudio-${new Date().toISOString().slice(0, 10)}.log`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="log-view" :class="{ compact }">
    <div class="log-tools">
      <div class="search-input"><Search :size="14" /><input v-model="query" aria-label="搜索日志" placeholder="搜索日志内容…" /></div>
      <select v-model="level" aria-label="日志级别"><option value="ALL">全部级别</option><option>INFO</option><option>WARNING</option><option>ERROR</option></select>
      <span class="muted log-count">{{ entries.length }} 条</span>
      <button class="log-action" :class="{ selected: follow }" aria-label="自动跟随日志" :aria-pressed="follow" :title="follow ? '自动跟随已开启：新日志到来时滚动到底部。点击暂停，便于查看历史记录。' : '跟随已暂停：保持当前阅读位置。点击后跳到最新日志并恢复自动滚动。'" @click="follow = !follow"><ArrowDownToLine v-if="follow" :size="15" /><Pause v-else :size="15" /><span>{{ follow ? '自动跟随' : '跟随已暂停' }}</span></button>
      <button class="log-action" aria-label="导出日志" title="将当前筛选出的日志导出为 .log 文本文件" @click="exportLogs"><ExportIcon :size="15" /><span>导出</span></button>
      <button class="log-action clear-logs" aria-label="清空日志" title="清空全部已保存日志，与当前筛选无关" :disabled="!studio.online || clearing || !studio.snapshot?.logs.length" @click="confirmingClear = true"><Trash2 :size="15" /><span>清空</span></button>
    </div>
    <div ref="scroll" class="log-lines" tabindex="0" aria-label="日志内容">
      <div v-for="entry in entries" :key="entry.id" class="log-line" :class="entry.level.toLowerCase()">
        <time>{{ time(entry.timestamp) }}</time><span class="log-level">{{ entry.level }}</span>
        <span class="log-source">{{ entry.source }}</span><span class="log-message">{{ entry.message }}</span>
      </div>
      <div v-if="!entries.length" class="empty-small">暂无符合筛选条件的日志</div>
    </div>
    <ConfirmDialog v-if="confirmingClear" title="清空全部日志？" confirm-label="确认清空" :busy="clearing" @cancel="confirmingClear = false" @confirm="clearLogs"><p>将清除内存显示和本机数据库中保存的全部日志，不仅是当前筛选结果。此操作不可撤销，建议先导出。</p><p>不会停止任务或断开设备；之后产生的新日志仍会正常记录。</p></ConfirmDialog>
  </section>
</template>
