import { beforeEach } from 'vitest';
import { resetRateLimits } from '@/lib/ratelimit';

// Run before every test file (vitest.config.ts setupFiles): each test starts with empty rate-limit counters
// (src/lib/ratelimit.ts keeps them for the whole process).
beforeEach(() => {
  resetRateLimits();
});
