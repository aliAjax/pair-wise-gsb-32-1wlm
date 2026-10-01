<template><div class="empty"><strong>{{ title }}</strong><p class="muted">{{ description }}</p></div></template>
<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>
<style scoped>.empty { border: 1px dashed #a8b8a1; border-radius: 8px; padding: 28px; text-align: center; background: #fffdf6; }</style>

