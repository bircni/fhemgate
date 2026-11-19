import { expect, it } from 'vitest';
import { sanitizeHapName } from './names.ts';

it('replaces every underscore and nothing else', () => {
  expect(sanitizeHapName('a_b__c d.e-f')).toBe('a-b--c d.e-f');
});

it('has a name for a device without one', () => {
  expect(sanitizeHapName(undefined)).toBe('FHEM Device');
  expect(sanitizeHapName(0)).toBe('0');
});
