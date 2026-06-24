import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT) || parseInt(process.env.OPENCODE_PROXY_PORT) || 80;

// Setup plugin and config
const pluginDir = '/home/node/.config/opencode/plugin/opencode2api-empty';
try {
    fs.mkdirSync(pluginDir, { recursive: true });
} catch (e) {}
try {
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 
        'export const Opencode2apiEmptyPlugin = async () => ({})\nexport default Opencode2apiEmptyPlugin\n');
} catch (e) {}
try {
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

console.log(`[Startup] Starting OpenCode2API Proxy on port ${PORT}...`);
console.log(`[Startup] Proxy will manage OpenCode backend automatically`);

const { startProxy } = await import('./src/proxy.js');

const config = {
    PORT: PORT,
    API_KEY: process.env.API_KEY || '',
    OPENCODE_SERVER_URL: `http://127.0.0.1:${parseInt(process.env.OPENCODE_SERVER_PORT) || 10001}`,
    OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
    MANAGE_BACKEND: true,
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
    startProxy(config);
} catch (error) {
    console.error('[Fatal] Failed to start proxy:', error.message);
    process.exit(1);
}