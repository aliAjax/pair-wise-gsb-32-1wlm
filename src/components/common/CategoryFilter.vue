<template>
  <el-radio-group :model-value="modelValue" @change="$emit('update:modelValue', String($event))">
    <el-radio-button label="all">全部</el-radio-button>
    <el-radio-button v-for="item in SPOT_CATEGORY_OPTIONS" :key="item.value" :label="item.value">{{ item.label }}</el-radio-button>
  </el-radio-group>
</template>
<script setup lang="ts">
import { SPOT_CATEGORY_OPTIONS } from '../../constants/spot';
defineProps<{ modelValue: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

