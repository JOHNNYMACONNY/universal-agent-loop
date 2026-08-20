export const UNTRUSTED_TARGET_CONTENT = 'UNTRUSTED_TARGET_CONTENT' as const;

export function markUntrustedTargetContent<T>(value: T): T {
  return value;
}

export function isTargetContentInstruction(_value: unknown): false {
  return false;
}
