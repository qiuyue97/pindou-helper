import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

export const VIP_UPSELL = '请升级VIP获取服务';

export function useVip() {
  const { me } = useAuth();
  const { show } = useToast();
  const isVip = me?.is_vip ?? false;

  /**
   * Wraps a VIP-only action. Normal accounts still SEE the control and can
   * click it — they get the upsell instead of the feature, which is the whole
   * point of leaving it visible.
   */
  function guard(run: () => void): () => void {
    return () => {
      if (isVip) run();
      else show(VIP_UPSELL);
    };
  }

  return { isVip, guard };
}
