/** Keyboard layout: number row 1-4 or home row A S D F map to target slots. */
const KEY_SLOTS: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, s: 1, d: 2, f: 3 };

export const SLOT_KEYS = ['1', '2', '3', '4'] as const;

export function keyToSlot(key: string): number | null {
  const slot = KEY_SLOTS[key.toLowerCase()];
  return slot === undefined ? null : slot;
}
