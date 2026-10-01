export function required(value: string, field: string) {
  if (!value.trim()) throw new Error(field + '不能为空');
  return value.trim();
}

