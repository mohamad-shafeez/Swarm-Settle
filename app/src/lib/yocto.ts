/**
 * Lossless integer yoctoNEAR <-> NEAR conversion utilities.
 * Never uses IEEE-754 floating-point arithmetic for on-chain amounts.
 * 1 NEAR = 10^24 yoctoNEAR.
 */

export const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;
const YOCTO_DECIMALS = 24;

export function parseNearToYocto(nearInput: string): bigint {
  const cleaned = nearInput.trim();
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid NEAR amount: "${nearInput}"`);
  }
  const [wholePart, fracPart = ''] = cleaned.split('.');
  if (fracPart.length > YOCTO_DECIMALS) {
    throw new Error('NEAR amount exceeds 24 decimal places (yoctoNEAR precision)');
  }
  const paddedFrac = fracPart.padEnd(YOCTO_DECIMALS, '0');
  return BigInt(wholePart) * YOCTO_PER_NEAR + BigInt(paddedFrac);
}

export function formatYoctoToNear(yoctoInput: string | bigint, maxFracDigits = 4): string {
  const val = typeof yoctoInput === 'bigint' ? yoctoInput : BigInt(yoctoInput || '0');
  const isNeg = val < 0n;
  const abs = isNeg ? -val : val;
  const whole = abs / YOCTO_PER_NEAR;
  const frac = abs % YOCTO_PER_NEAR;
  if (frac === 0n) {
    return `${isNeg ? '-' : ''}${whole.toString()}`;
  }
  const fracStr = frac.toString().padStart(YOCTO_DECIMALS, '0').slice(0, maxFracDigits).replace(/0+$/, '');
  return fracStr ? `${isNeg ? '-' : ''}${whole.toString()}.${fracStr}` : `${isNeg ? '-' : ''}${whole.toString()}`;
}
