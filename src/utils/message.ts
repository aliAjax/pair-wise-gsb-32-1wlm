import { ElMessage } from 'element-plus';
export const toast = {
  ok: (message: string) => ElMessage.success(message),
  warn: (message: string) => ElMessage.warning(message),
  fail: (message: string) => ElMessage.error(message),
};

