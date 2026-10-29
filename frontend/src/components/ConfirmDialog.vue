<script setup lang="ts">
import { onMounted, ref, useId } from 'vue'

withDefaults(defineProps<{ title: string; confirmLabel?: string; busy?: boolean }>(), { confirmLabel: '确认', busy: false })
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = `confirm-${useId()}`
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="dialog confirm-dialog" :aria-labelledby="titleId" @cancel.prevent="!busy && emit('cancel')">
    <form @submit.prevent="!busy && emit('confirm')"><h2 :id="titleId">{{ title }}</h2><div class="confirm-content"><slot /></div>
      <div class="dialog-footer"><button type="button" class="button" autofocus :disabled="busy" @click="emit('cancel')">取消</button><button class="button danger" :disabled="busy">{{ busy ? '处理中…' : confirmLabel }}</button></div>
    </form>
  </dialog>
</template>
