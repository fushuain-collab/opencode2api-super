import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORT = parseInt(process.env.PORT) || parseInt(process.env.OPENCODE_PROXY_PORT) || 80;

// Step 1: Ensure opencode binary is available
async function ensureOpencode() {
    // Try finding opencode
    try {
        execSync('opencode --version', { stdio: 'pipe' });
        console.log('[Startup] opencode found in PATH');
        return 'opencode';
    } catch (e) {
        console.log('[Startup] opencode not in PATH, checking node_modules...');
    }

    // Check in node_modules
    const localBin = path.join(process.cwd(), 'node_modules', '.bin', 'opencode');
    if (fs.existsSync(localBin)) {
        console.log('[Startup] opencode found in node_modules/.bin');
        return localBin;
    }

    const npmBin = path.join(process.cwd(), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (fs.existsSync(npmBin)) {
        console.log('[Startup] opencode found in opencode-ai package');
        return npmBin;
    }

    // Try to install opencode-linux-x64 directly (smaller, no postinstall)
    console.log('[Startup] Installing opencode binary package...');
    try {
        execSync('npm install opencode-linux-x64@1.17.9 --ignore-scripts --no-save 2>&1', { 
            stdio: 'pipe', 
            timeout: 120000,
            cwd: process.cwd()
        });
        const binPath = path.join(process.cwd(), 'node_modules', 'opencode-linux-x64', 'bin', 'opencode');
        if (fs.existsSync(binPath)) {
            fs.chmodSync(binPath, 0o755);
            console.log('[Startup] opencode binary installed successfully');
            return binPath;
        }
    } catch (err) {
        console.warn('[Startup] npm install opencode-linux-x64 failed:', err.message);
    }

    // Last resort: use npx
    console.log('[Startup] Will use npx to run opencode');
    return 'npx';
}

// Setup plugin directory
try {
    const pluginDir = '/home/node/.config/opencode/plugin/opencode2api-empty';
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

// Step 2: Install opencode if needed, then start proxy
const opencodeBin = await ensureOpencode();

console.log(`[Startup] Starting OpenCode2API Proxy on port ${PORT}...`);
console.log(`[Startup] Using opencode binary: ${opencodeBin}`);

const { startProxy } = await import('./src/proxy.js');

const config = {
    PORT: PORT,
    API_KEY: process.env.API_KEY || '',
    OPENCODE_SERVER_URL: `http://127.0.0.1:${parseInt(process.env.OPENCODE_SERVER_PORT) || 10001}`,
    OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
    MANAGE_BACKEND: true,
    OPENCODE_PATH: opencodeBin,
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