<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const presets = [19200, 38400, 56000, 57600, 115200, 128000, 230400, 256000, 460800, 512000, 750000, 921600, 1000000, 1500000, 2000000]
const listId = `baud-${useId()}`
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const opened = ref(false)
const active = ref(0)
const above = ref(false)
const listHeight = ref(240)
const invalid = computed(() => !/^\d+$/.test(props.modelValue) || Number(props.modelValue) < 50 || Number(props.modelValue) > 12000000)

watch(() => props.modelValue, value => {
  input.value?.setCustomValidity(/^\d+$/.test(value) && Number(value) >= 50 && Number(value) <= 12000000
    ? '' : '请输入 50～12000000 范围内的整数波特率')
}, { flush: 'post', immediate: true })

async function show() {
  if (props.disabled) return
  const bounds = root.value!.getBoundingClientRect()
  const dialog = root.value!.closest('.connection-dialog')?.getBoundingClientRect()
  const below = Math.min(innerHeight, dialog?.bottom ?? innerHeight) - bounds.bottom - 12
  const over = bounds.top - Math.max(0, dialog?.top ?? 0) - 12
  above.value = below < 210 && over > below
  listHeight.value = Math.max(80, Math.min(240, above.value ? over : below))
  active.value = Math.max(0, presets.indexOf(Number(props.modelValue)))
  opened.value = true
  await nextTick()
  document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: 'nearest' })
}

function choose(index: number) {
  emit('update:modelValue', String(presets[index]))
  opened.value = false
  input.value?.focus()
}

async function keydown(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    if (!opened.value) { await show(); return }
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : presets.length - 1)) % presets.length
    await nextTick()
    document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: 'nearest' })
  } else if (opened.value && event.key === 'Enter') {
    event.preventDefault()
    choose(active.value)
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    if (opened.value && event.key === 'Escape') { event.preventDefault(); event.stopPropagation() }
    opened.value = false
  }
}

function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) opened.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="baud-control" @focusout="event => { if (!root?.contains(event.relatedTarget as Node)) opened = false }">
    <div class="baud-input-wrap">
      <input ref="input" :value="modelValue" aria-label="波特率" role="combobox" aria-autocomplete="none"
        :aria-expanded="opened" :aria-controls="listId" :aria-activedescendant="opened ? `${listId}-${active}` : undefined"
        :aria-invalid="invalid" inputmode="numeric" pattern="[0-9]+" maxlength="8" required :disabled="disabled"
        placeholder="选择或输入波特率" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @keydown="keydown" />
      <button type="button" class="baud-toggle" :disabled="disabled" :aria-label="opened ? '收起波特率列表' : '展开波特率列表'"
        :aria-expanded="opened" :aria-controls="listId" @mousedown.prevent @click="opened ? (opened = false) : show()"><ChevronDown :size="15" /></button>
    </div>
    <div v-if="opened" :id="listId" role="listbox" aria-label="预设波特率" class="baud-options" :class="{ above }" :style="{ maxHeight: `${listHeight}px` }">
      <button v-for="(value, index) in presets" :id="`${listId}-${index}`" :key="value" role="option" type="button" tabindex="-1"
        :aria-selected="Number(modelValue) === value" :class="{ highlighted: active === index }" @mousedown.prevent @click="choose(index)">
        <span>{{ value }}</span><Check v-if="Number(modelValue) === value" :size="13" />
      </button>
    </div>
  </div>
</template>
