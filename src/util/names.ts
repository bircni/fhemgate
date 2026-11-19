/**
 * A name HomeKit accepts. fhem allows the underscore in device names, HAP-NodeJS 2 does not
 * allow it in the name of an accessory.
 */
export function sanitizeHapName(name: string | number | null | undefined): string {
  const text = (name === undefined || name === null) ? '' : String(name);
  return text.replace(/[_]/g, '-') || 'FHEM Device';
}
