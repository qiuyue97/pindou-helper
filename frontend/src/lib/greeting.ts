/**
 * Time-of-day greeting.
 *
 * Four buckets, as asked for. Note that with only four, the 中午 band has to
 * stretch to 17:59 — adding a 下午 band would need a fifth.
 */
export function greetingFor(when: number | Date = new Date()): string {
  const hour = typeof when === 'number' ? when : when.getHours();
  if (hour < 6) return '凌晨好';
  if (hour < 12) return '早上好';
  if (hour < 18) return '中午好';
  return '晚上好';
}
