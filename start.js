import { execFile, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORT = parseInt(process.env.PORT, 10) || parseInt(process.env.OPENCODE_PROXY_PORT, 10) || 80;
const BACKEND_PORT = parseInt(process.env.OPENCODE_SERVER_PORT, 10) || 10001;
const OPENCODE_VERSION = process.env.OPENCODE_BINARY_VERSION || '1.17.9';
const RUNTIME_DIR = process.env.OPENCODE_RUNTIME_DIR || '/tmp/opencode-runtime';
const OPENCODE_BIN = process.env.OPENCODE_PATH || path.join(
    RUNTIME_DIR,
    'node_modules',
    'opencode-linux-x64',
    'bin',
    'opencode'
);

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

function canRun(command, args = ['--version']) {
    try {
        execFileSync(command, args, { stdio: 'pipe', timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

function installOpencodeBinary() {
    if (fileExists(OPENCODE_BIN)) {
        fs.chmodSync(OPENCODE_BIN, 0o755);
        console.log(`[Startup] OpenCode binary already available: ${OPENCODE_BIN}`);
        return;
    }

    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const npmArgs = [
        'install',
        `opencode-linux-x64@${OPENCODE_VERSION}`,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--omit=dev',
        '--no-package-lock',
        '--prefix',
        RUNTIME_DIR
    ];

    const attemptInstall = (attempt) => {
        console.log(`[Startup] Installing OpenCode binary attempt ${attempt}/5 into ${RUNTIME_DIR}...`);
        const child = execFile('npm', npmArgs, {
            cwd: '/tmp',
            timeout: 10 * 60 * 1000,
            maxBuffer: 1024 * 1024 * 8,
            env: {
                ...process.env,
                npm_config_cache: path.join('/tmp', 'npm-cache'),
                npm_config_update_notifier: 'false',
                npm_config_progress: 'false'
            }
        }, (error, stdout, stderr) => {
            if (stdout?.trim()) console.log(stdout.trim());
            if (stderr?.trim()) console.warn(stderr.trim());

            if (!error && fileExists(OPENCODE_BIN)) {
                fs.chmodSync(OPENCODE_BIN, 0o755);
                console.log(`[Startup] OpenCode binary ready: ${OPENCODE_BIN}`);
                return;
            }

            const reason = error ? error.message : 'binary missing after npm install';
            console.warn(`[Startup] OpenCode binary install failed: ${reason}`);
            if (attempt < 5) {
                const delayMs = Math.min(30000 * attempt, 120000);
                console.warn(`[Startup] Retrying OpenCode install in ${delayMs / 1000}s...`);
                setTimeout(() => attemptInstall(attempt + 1), delayMs);
            } else {
                console.error('[Startup] OpenCode binary is not ready. Proxy stays online; requests will recover after a successful redeploy or manual retry.');
            }
        });

        child.on('error', (error) => {
            console.warn(`[Startup] Failed to launch npm installer: ${error.message}`);
        });
    };

    attemptInstall(1);
}

function setupPluginConfig() {
    try {
        const homeDir = process.env.HOME || '/tmp';
        const configDir = path.join(homeDir, '.config', 'opencode');
        const pluginDir = path.join(configDir, 'plugin', 'opencode2api-empty');
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(
            path.join(pluginDir, 'index.js'),
            'export const Opencode2apiEmptyPlugin = async () => ({})\nexport default Opencode2apiEmptyPlugin\n',
            'utf8'
        );
        fs.writeFileSync(
            path.join(configDir, 'opencode.json'),
            JSON.stringify({
                plugin: [path.join(pluginDir, 'index.js')],
                instructions: [],
                theme: 'system'
            }, null, 2),
            'utf8'
        );
        console.log('[Startup] Plugin setup complete');
    } catch (error) {
        console.warn('[Startup] Plugin setup warning:', error.message);
    }
}

setupPluginConfig();

if (canRun('opencode')) {
    console.log('[Startup] System opencode is available in PATH');
} else if (fileExists(OPENCODE_BIN)) {
    fs.chmodSync(OPENCODE_BIN, 0o755);
    console.log(`[Startup] Runtime opencode is available: ${OPENCODE_BIN}`);
} else {
    installOpencodeBinary();
}

console.log(`[Startup] Starting OpenCode2API Proxy immediately on port ${PORT}...`);
console.log(`[Startup] Managed backend binary path: ${OPENCODE_BIN}`);

const { startProxy } = await import('./src/proxy.js');

const config = {
    PORT,
    API_KEY: process.env.API_KEY || '',
    OPENCODE_SERVER_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
    MANAGE_BACKEND: true,
    OPENCODE_PATH: canRun('opencode') ? 'opencode' : OPENCODE_BIN,
    BIND_HOST: '0.0.0.0',
    DISABLE_TOOLS: process.env.DISABLE_TOOLS === 'false' ? false : true,
    EXTERNAL_TOOLS_MODE: process.env.OPENCODE_EXTERNAL_TOOLS_MODE || 'proxy-bridge',
    INTERNAL_WEB_FETCH_ENABLED: process.env.OPENCODE_INTERNAL_WEB_FETCH_ENABLED === 'true',
    INTERNAL_ALLOWED_TOOLS: (process.env.OPENCODE_INTERNAL_ALLOWED_TOOLS || '').split(',').map(entry => entry.trim()).filter(Boolean),
    HEALTH_DETAILS_ENABLED: process.env.OPENCODE_HEALTH_DETAILS_ENABLED !== 'false',
    METRICS_ENABLED: process.env.OPENCODE_METRICS_ENABLED === 'true',
    PROMPT_MODE: process.env.OPENCODE_PROXY_PROMPT_MODE || 'plugin-inject',
    OMIT_SYSTEM_PROMPT: process.env.OPENCODE_PROXY_OMIT_SYSTEM_PROMPT === 'true',
    AUTO_CLEANUP_CONVERSATIONS: process.env.OPENCODE_PROXY_AUTO_CLEANUP_CONVERSATIONS === 'true',
    CLEANUP_INTERVAL_MS: parseInt(process.env.OPENCODE_PROXY_CLEANUP_INTERVAL_MS, 10) || 3600000,
    CLEANUP_MAX_AGE_MS: parseInt(process.env.OPENCODE_PROXY_CLEANUP_MAX_AGE_MS, 10) || 43200000,
    REQUEST_TIMEOUT_MS: parseInt(process.env.OPENCODE_PROXY_REQUEST_TIMEOUT_MS, 10) || 600000,
    DEBUG: process.env.OPENCODE_PROXY_DEBUG === 'true',
    OPENCODE_HOME_BASE: process.env.HOME || '/tmp'
};

try {
    const proxy = startProxy(config);
    process.on('SIGTERM', () => {
        console.log('[Startup] SIGTERM received, shutting down...');
        try { proxy.killBackend?.(); } catch { }
        proxy.server?.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
} catch (error) {
    console.error('[Fatal] Failed to start proxy:', error);
    process.exit(1);
}
