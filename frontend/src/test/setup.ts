import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom implements neither of these (same gap as its missing canvas). The image
// picker builds preview URLs with them, so without a stub every test that
// touches it dies on "URL.createObjectURL is not a function". Counter-based so
// each call returns a distinct URL, which is what React keys on.
let objectUrlSeq = 0;
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => `blob:test/${++objectUrlSeq}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}

afterEach(() => {
  cleanup();
});
