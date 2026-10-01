import { defineComponent, h, ref, onErrorCaptured } from 'vue';
import { toast } from '../../utils/message';

export default defineComponent({
  name: 'GlobalErrorBoundary',
  setup(_, { slots }) {
    const error = ref('');
    onErrorCaptured((err) => {
      error.value = err instanceof Error ? err.message : String(err);
      toast.fail(error.value);
      return false;
    });
    return () => error.value ? h('div', { class: 'band' }, '页面异常：' + error.value) : slots.default?.();
  },
});

