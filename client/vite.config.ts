import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function git (args: string[]): string | null {
    try {
        return execSync(`git ${args.join(' ')}`, {
            cwd: repoRoot,
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
    } catch {
        return null;
    }
}

const commit = process.env.APP_COMMIT || git(['rev-parse', 'HEAD']) || 'unknown';
const shortCommit = commit === 'unknown' ? 'unknown' : commit.slice(0, 7);
const branch = process.env.APP_BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
const dirty = process.env.APP_DIRTY !== undefined
    ? process.env.APP_DIRTY === 'true'
    : (git(['status', '--porcelain']) || '').length > 0;
const describe = process.env.APP_VERSION || git(['describe', '--always', '--tags', '--dirty']) || shortCommit;

const buildMeta = {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_SHORT_COMMIT__: JSON.stringify(shortCommit),
    __APP_BRANCH__: JSON.stringify(branch),
    __APP_DESCRIBE__: JSON.stringify(describe),
    __APP_DIRTY__: JSON.stringify(dirty),
    __APP_BUILD_TIME__: JSON.stringify(process.env.APP_BUILD_TIME || new Date().toISOString())
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  },
    build: {
        target: 'es2020',
        sourcemap: true,
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom'],
                    icons: ['lucide-react']
                }
            }
        }
    },
    define: buildMeta
});
