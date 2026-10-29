<script setup lang="ts">
import { Activity, Square, CheckCircle2, Clock, ListChecks } from '@lucide/vue'
import { useStudio, maskedHex } from '../stores/studio'
const studio = useStudio()
const statusNames: Record<string, string> = { running: '执行中', cancelling: '正在停止', completed: '已完成', cancelled: '已停止', failed: '失败' }
</script>

<template>
  <div class="page tasks-page"><div class="page-heading"><div><div class="eyebrow">WORKSPACE / TASKS</div><h1>任务中心</h1><p>任务由内核管理，切换标签后继续执行。</p></div><span class="badge">全局单硬件任务</span></div>
    <section v-if="studio.snapshot?.task" class="panel task-detail"><div class="task-title"><div class="device-icon"><Activity :size="24" /></div><div><h2>{{ studio.snapshot.task.name }}</h2><span class="muted">模拟任务 · {{ studio.connections.find(item => item.id === studio.snapshot?.task?.connection_id)?.name }}</span></div><span class="badge" :class="{ green: studio.snapshot.task.status === 'completed' }">{{ statusNames[studio.snapshot.task.status] }}</span></div>
      <div class="task-progress"><div :style="{ width: `${studio.snapshot.task.progress * 100}%` }" /></div><div class="task-meta"><span>{{ studio.snapshot.task.completed }} / {{ studio.snapshot.task.total }} 个寄存器读取</span><strong>{{ Math.round(studio.snapshot.task.progress * 100) }}%</strong></div>
      <p v-if="studio.snapshot.task.error" class="error-text">{{ studio.snapshot.task.error }}</p>
      <button v-if="studio.taskActive" class="button danger" :disabled="studio.busy || studio.snapshot.task.status === 'cancelling'" @click="studio.cancelTask"><Square :size="14" />停止任务</button>
      <div v-else class="task-done"><CheckCircle2 :size="16" />设备占用已释放，连接保持在线。</div>
      <div class="task-results"><h3><ListChecks :size="17" />读取结果</h3><table class="simple-table"><thead><tr><th>轮次</th><th>地址</th><th>读回值</th></tr></thead><tbody><tr v-for="(result, index) in studio.snapshot.task.results" :key="index"><td>{{ result.pass_index }}</td><td><code>{{ result.address }}</code></td><td><code>{{ maskedHex(result.value, result.readable_mask) }}</code></td></tr></tbody></table></div>
    </section>
    <div v-else class="empty-state panel"><Clock :size="36" /><h2>还没有运行任务</h2><p>后续采集与测试任务的进度、结果和停止操作会在这里显示。</p></div>
  </div>
</template>
