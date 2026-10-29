<script setup lang="ts">
import { computed } from 'vue'
import type { RegisterDefinition } from '../types'
import { fieldMask, SELF_CLEAR_ACCESS } from '../stores/studio'

const props = defineProps<{ register: RegisterDefinition; value?: number; mask?: number; disabled: boolean }>()
const emit = defineEmits<{ edit: [value: number, mask: number] }>()
// 字段与提示仅在定义变化时计算，编辑时不再为每个位的多个属性反复查找字段。
const bits = computed(() => Array.from({ length: 32 }, (_, index) => {
  const bit = 31 - index
  const field = props.register.fields.find(item => bit >= item.lsb && bit <= item.msb)!
  return {
    bit, color: field.color, readOnly: !['RW', 'W1C', 'WO', ...SELF_CLEAR_ACCESS].includes(field.access),
    title: `${field.name} [${field.msb}:${field.lsb}] · ${field.access} · ${field.description}${field.access === 'WO' ? ' · 显示待写值，无有效读回值' : SELF_CLEAR_ACCESS.includes(field.access) ? ' · 写 1 后硬件自动清 0，显示待写命令' : ''}`,
  }
}))
const bitSet = (bit: number) => ((props.value ?? 0) & (2 ** bit)) !== 0
const changed = (bit: number) => ((props.mask ?? 0) & 2 ** bit) !== 0

function toggle(bit: number) {
  emit('edit', ((props.value ?? 0) ^ 2 ** bit) >>> 0, fieldMask(bit, bit))
}
</script>

<template>
  <div class="bits" role="group" :aria-label="`${register.name} 32 位编辑器`">
    <div v-for="item in bits" :key="item.bit" class="bit-cell" :class="[`field-${item.color}`, { 'nibble-start': item.bit % 4 === 3 && item.bit !== 31 }]">
      <span class="bit-index">{{ item.bit }}</span>
      <button class="bit-button" :class="{ set: bitSet(item.bit), changed: changed(item.bit) }"
        :disabled="disabled || item.readOnly || value === undefined" :title="item.title"
        :aria-label="`${register.name} bit ${item.bit}`" :aria-pressed="bitSet(item.bit)" @click="toggle(item.bit)">
        {{ value === undefined ? '·' : bitSet(item.bit) ? '1' : '0' }}
      </button>
    </div>
  </div>
</template>
