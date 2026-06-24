import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROXY_PORT = parseInt(process.env.PORT) || parseInt(process.env.OPENCODE_PROXY_PORT) || 10000;
const SERVER_PORT = parseInt(process.env.OPENCODE_SERVER_PORT) || 10001;

console.log(`[Startup] OpenCode Server port: ${SERVER_PORT}, Proxy port: ${PROXY_PORT}`);

// Step 1: Start OpenCode Server
console.log('[Startup] Starting OpenCode Server...');
// OpenCode Server process (binary should be in PATH from Dockerfile)
const serverProcess = spawn('opencode', ['serve', '--hostname', '0.0.0.0', '--port', String(SERVER_PORT)], {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, HOME: process.env.HOME || '/home/node' }
});

// Step 2: Wait for server to be ready
async function waitForServer(maxRetries = 120, intervalMs = 2000) {
    for (let i = 1; i <= maxRetries; i++) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://127.0.0.1:${SERVER_PORT}/health`, (res) => {
                    if (res.statusCode === 200) resolve(true);
                    else reject(new Error(`Status ${res.statusCode}`));
                });
                req.on('error', reject);
                req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
            });
            console.log(`[Startup] OpenCode Server is ready! (after ${i} attempts)`);
            return true;
        } catch (e) {
            if (i % 10 === 0) console.log(`[Startup] Waiting for OpenCode Server... (${i}/${maxRetries})`);
            if (!serverProcess.killed && serverProcess.exitCode !== null) {
                console.error('[Startup] OpenCode Server exited prematurely!');
                process.exit(1);
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }
    console.error('[Startup] Timeout waiting for OpenCode Server');
    process.exit(1);
}

// Step 3: Start proxy
async function main() {
    // Plugin setup
    const pluginDir = '/home/node/.config/opencode/plugin/opencode2api-empty';
    if (process.env.OPENCODE_PROXY_PROMPT_MODE === 'plugin-inject' || !process.env.OPENCODE_PROXY_PROMPT_MODE) {
        try {
            fs.mkdirSync(pluginDir, { recursive: true });
            fs.writeFileSync(path.join(pluginDir, 'index.js'), 
                'export const Opencode2apiEmptyPlugin = async () => ({})\nexport default Opencode2apiEmptyPlugin\n');
            const configDir = '/home/node/.config/opencode';
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(path.join(configDir, 'opencode.json'), 
                JSON.stringify({
                    plugin: [path.join(pluginDir, 'index.js')],
                    instructions: [],
                    theme: 'system'
                }, null, 2));
            console.log('[Startup] Plugin setup complete');
        } catch (e) {
            console.warn('[Startup] Plugin setup warning:', e.message);
        }
    }

    await waitForServer();
    
    // Now import and start the proxy
    console.log('[Startup] Starting Proxy...');
    const { startProxy } = await import('./src/proxy.js');
    
    const config = {
        PORT: PROXY_PORT,
        API_KEY: process.env.API_KEY || '',
        OPENCODE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`,
        OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
        MANAGE_BACKEND: false,
        OPENCODE_PATH: 'opencode',
        BIND_HOST: '0.0.0.0',
        DISABLE_TOOLS: process.env.DISABLE_TOOLS === 'false' ? false : true,
        EXTERNAL_TOOLS_MODE: process.env.OPENCODE_EXTERNAL_TOOLS_MODE || 'proxy-bridge',
        INTERNAL_WEB_FETCH_ENABLED: process.env.OPENCODE_INTERNAL_WEB_FETCH_ENABLED === 'true',
        INTERNAL_ALLOWED_TOOLS: (process.env.OPENCODE_INTERNAL_ALLOWED_TOOLS || '').split(',').filter(Boolean),
        HEALTH_DETAILS_ENABLED: process.env.OPENCODE_HEALTH_DETAILS_ENABLED !== 'false',
        METRICS_ENABLED: process.env.OPENCODE_METRICS_ENABLED === 'true',
        PROMPT_MODE: process.env.OPENCODE_PROXY_PROMPT_MODE || 'standard',
        OMIT_SYSTEM_PROMPT: process.env.OPENCODE_PROXY_OMIT_SYSTEM_PROMPT === 'true',
        AUTO_CLEANUP_CONVERSATIONS: process.env.OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS === 'true',
        CLEANUP_INTERVAL_MS: parseInt(process.env.OPENCODE_PROXY_CLEANUP_INTERVAL_MS) || 3600000,
        CLEANUP_MAX_AGE_MS: parseInt(process.env.OPENCODE_PROXY_CLEANUP_MAX_AGE_MS) || 43200000,
        REQUEST_TIMEOUT_MS: parseInt(process.env.OPENCODE_PROXY_REQUEST_TIMEOUT_MS) || 600000,
        DEBUG: process.env.OPENCODE_PROXY_DEBUG === 'true',
        OPENCODE_HOME_BASE: process.env.HOME || '/home/node'
    };
    
    try {
        const proxy = startProxy(config);
        
        process.on('SIGINT', () => {
            console.log('\n[Shutdown] Received SIGINT');
            serverProcess.kill();
            proxy.server?.close();
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.log('\n[Shutdown] Received SIGTERM');
            serverProcess.kill();
            proxy.server?.close();
            process.exit(0);
        });
    } catch (error) {
        console.error('[Fatal] Failed to start proxy:', error.message);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[Fatal]', err);
    process.exit(1);
});