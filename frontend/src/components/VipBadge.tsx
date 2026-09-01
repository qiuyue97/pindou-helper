import { Crown } from 'lucide-react';

/**
 * Marks a VIP-only feature. Rendered for everyone — normal accounts need to see
 * what they are being offered, not have it hidden from them.
 */
export default function VipBadge({ locked = false }: { locked?: boolean }) {
  return (
    <span className={`vip-badge${locked ? ' is-locked' : ''}`} title={locked ? '需要 VIP' : 'VIP 功能'}>
      <Crown size={11} aria-hidden="true" />
      VIP
    </span>
  );
}
