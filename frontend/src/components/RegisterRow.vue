<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownToLine, Eye, RotateCcw, Trash2 } from '@lucide/vue'
import BitEditor from './BitEditor.vue'
import { hex, maskedHex, readableMask, useStudio } from '../stores/studio'
import type { RegisterDefinition } from '../types'

const props = defineProps<{ register: RegisterDefinition; selected: boolean; checked: boolean; canManage: boolean }>()
const emit = defineEmits<{ select: []; check: [checked: boolean]; delete: [] }>()
const studio = useStudio()
const state = computed(() => studio.stateFor(props.register.address))
const readable = computed(() => readableMask(props.register))
const writable = computed(() => studio.writableMask(props.register))
const readLabel = computed(() => !readable.value ? '— WO 只写 —' : state.value?.actual == null
  ? '— 尚未读取 —' : maskedHex(state.value.actual, readable.value))

function updateHex(event: Event) {
  const input = event.target as HTMLInputElement
  if (!/^0x[0-9a-f]{1,8}$/i.test(input.value)) {
    studio.notify('请输入 0x 开头、最多 8 位的十六进制数', true)
    input.value = hex(state.value?.draft ?? 0)
    return
  }
  studio.edit(props.register, Number.parseInt(input.value, 16), writable.value)
}
</script>

<template>
  <tr class="register-data-row" :data-testid="`register-${register.name}`" :class="{ 'selected-row': selected, 'dirty-row': state?.mask }" @click="emit('select')">
    <td><div class="register-identity"><input type="checkbox" class="register-checkbox" :checked="checked" :disabled="!canManage" :aria-label="`选择 ${register.name}`" @click.stop @change="emit('check', ($event.target as HTMLInputElement).checked)" /><div class="register-identity-text"><button class="register-name" :title="register.name" @click="emit('select')">{{ register.name }}</button><code class="address">{{ register.address }}</code><span v-if="state?.verified" class="verified-label">{{ state.unverifiedMask ? '✓ 可读位已校验' : '✓ 已校验' }}</span><span v-if="state?.unverifiedMask" class="unverified-label">已提交 · WO/自清零位未校验</span></div></div></td>
    <td class="value-cell"><div class="read-value" :title="readable !== 0xFFFFFFFF ? '? 表示含 WO 只写位，无有效读回值' : undefined">{{ readLabel }}</div>
      <input :value="state ? hex(state.draft) : ''" :aria-label="`${register.name} 待写值`" :placeholder="readable ? '读取后编辑' : '输入待写值'" spellcheck="false" class="hex-input" :class="{ dirty: state?.mask }" :disabled="!studio.canOperate || !state || !writable" @change="updateHex" />
    </td>
    <td><BitEditor :register="register" :value="state?.draft" :mask="state?.mask" :disabled="!studio.canOperate" @edit="(value, mask) => studio.edit(register, value, mask)" /></td>
    <td><div class="row-actions"><button class="icon-button" :disabled="!studio.canOperate || !readable" :aria-label="`读取 ${register.name}`" :title="readable ? '读取可读位（覆盖未提交编辑），WO 位无有效读回值' : 'WO 只写寄存器不能读取'" @click.stop="studio.readOne(register)"><Eye :size="16" /></button><button class="icon-button write-button" :disabled="!studio.canOperate || !state?.mask" :aria-label="`写入 ${register.name}`" title="提交待写值；仅校验可读位，WO/自清零位未校验" @click.stop="studio.writeOne(register)"><ArrowDownToLine :size="16" /></button><button class="icon-button" :disabled="!studio.canOperate || !state?.mask" :aria-label="`撤销 ${register.name} 修改`" title="撤销编辑" @click.stop="studio.discardChanges(register)"><RotateCcw :size="14" /></button><button class="icon-button delete-register" :disabled="!canManage" :aria-label="`删除 ${register.name}`" title="只从工作台删除定义，不写入设备" @click.stop="emit('delete')"><Trash2 :size="15" /></button></div></td>
  </tr>
</template>
