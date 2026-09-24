import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Register jest-dom matchers on this workspace's vitest `expect` explicitly
// (the package's /vitest entry could resolve a different hoisted vitest).
expect.extend(matchers);
afterEach(cleanup);
