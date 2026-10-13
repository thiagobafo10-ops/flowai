import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, test: { include: ['src/lib/inbox/*.test.ts', 'src/lib/instagram/*.test.ts', 'src/lib/ai/*.test.ts', 'src/app/**/*.test.ts', 'src/components/**/*.test.ts'] } });
