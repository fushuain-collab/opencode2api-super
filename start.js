import { spawn, execFile, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const PORT = parseInt(process.env.PORT, 10) || parseInt(process.env.OPENCODE_PROXY_PORT, 10) || 80;
const BACKEND_PORT = parseInt(process.env.OPENCODE_SERVER_PORT, 10) || 10001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const OPENCODE_VERSION = process.env.OPENCODE_BINARY_VERSION || '1.17.9';
const RUNTIME_DIR = process.env.OPENCODE_RUNTIME_DIR || '/tmp/opencode-runtime';
const RUNTIME_BIN = path.join(RUNTIME_DIR, 'node_modules', 'opencode-linux-x64', 'bin', 'opencode');
const PREFERRED_BIN = process.env.OPENCODE_PATH || RUNTIME_BIN;
const INSTALL_MAX_ATTEMPTS = parseInt(process.env.OPENCODE_INSTALL_MAX_ATTEMPTS, 10) || 5;
const BACKEND_RESTART_DELAY_MS = parseInt(process.env.OPENCODE_BACKEND_RESTART_DELAY_MS, 10) || 5000;

let backendProcess = null;
let backendReady = false;
let shuttingDown = false;
let installInProgress = false;

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

function resolveOpencodeBinary() {
    if (process.env.OPENCODE_PATH && fileExists(process.env.OPENCODE_PATH)) {
        fs.chmodSync(process.env.OPENCODE_PATH, 0o755);
        return process.env.OPENCODE_PATH;
    }

    if (fileExists(RUNTIME_BIN)) {
        fs.chmodSync(RUNTIME_BIN, 0o755);
        return RUNTIME_BIN;
    }

    if (!process.env.OPENCODE_PATH && canRun('opencode')) {
        return 'opencode';
    }

    return null;
}

function installOpencodeBinary(attempt = 1) {
    if (installInProgress || shuttingDown) return;

    const readyBinary = resolveOpencodeBinary();
    if (readyBinary) {
        console.log(`[Startup] OpenCode binary ready: ${readyBinary}`);
        startBackend(readyBinary);
        return;
    }

    installInProgress = true;
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

    console.log(`[Startup] Installing OpenCode binary attempt ${attempt}/${INSTALL_MAX_ATTEMPTS} into ${RUNTIME_DIR}...`);
    const child = execFile('npm', npmArgs, {
        cwd: '/tmp',
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 16,
        env: {
            ...process.env,
            npm_config_cache: path.join('/tmp', 'npm-cache'),
            npm_config_update_notifier: 'false',
            npm_config_progress: 'false'
        }
    }, (error, stdout, stderr) => {
        installInProgress = false;
        if (stdout?.trim()) console.log(stdout.trim());
        if (stderr?.trim()) console.warn(stderr.trim());

        const ready = resolveOpencodeBinary();
        if (!error && ready) {
            console.log(`[Startup] OpenCode binary installed: ${ready}`);
            startBackend(ready);
            return;
        }

        const reason = error ? error.message : 'binary missing after npm install';
        console.warn(`[Startup] OpenCode binary install failed: ${reason}`);
        if (attempt < INSTALL_MAX_ATTEMPTS) {
            const delayMs = Math.min(30000 * attempt, 120000);
            console.warn(`[Startup] Retrying OpenCode install in ${delayMs / 1000}s...`);
            setTimeout(() => installOpencodeBinary(attempt + 1), delayMs).unref();
        } else {
            console.error('[Startup] OpenCode backend is unavailable after all install attempts. Proxy remains online for health diagnostics.');
        }
    });

    child.on('error', (error) => {
        installInProgress = false;
        console.warn(`[Startup] Failed to launch npm installer: ${error.message}`);
    });
}

function startBackend(opencodeBin) {
    if (shuttingDown || backendProcess) return;

    const args = ['serve', '--port', String(BACKEND_PORT), '--hostname', '127.0.0.1'];
    const env = {
        ...process.env,
        OPENCODE_SERVER_PORT: String(BACKEND_PORT),
        OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
        HOME: process.env.HOME || '/tmp'
    };

    console.log(`[Startup] Starting OpenCode backend: ${opencodeBin} ${args.join(' ')}`);
    backendProcess = spawn(opencodeBin, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    backendProcess.stdout.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.log(`[OpenCode] ${text}`);
    });

    backendProcess.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.warn(`[OpenCode] ${text}`);
    });

    backendProcess.on('error', (error) => {
        console.error(`[Startup] OpenCode backend failed to spawn: ${error.message}`);
        backendProcess = null;
        backendReady = false;
        scheduleBackendRecovery();
    });

    backendProcess.on('exit', (code, signal) => {
        console.warn(`[Startup] OpenCode backend exited with code=${code} signal=${signal}`);
        backendProcess = null;
        backendReady = false;
        scheduleBackendRecovery();
    });

    waitForBackendReady();
}

function scheduleBackendRecovery() {
    if (shuttingDown) return;
    setTimeout(() => {
        if (shuttingDown || backendProcess) return;
        const binary = resolveOpencodeBinary();
        if (binary) startBackend(binary);
        else installOpencodeBinary();
    }, BACKEND_RESTART_DELAY_MS).unref();
}

async function waitForBackendReady(attempt = 1) {
    if (shuttingDown || !backendProcess) return;

    try {
        const response = await fetch(`${BACKEND_URL}/health`, {
            headers: process.env.OPENCODE_SERVER_PASSWORD
                ? { Authorization: `Bearer ${process.env.OPENCODE_SERVER_PASSWORD}` }
                : undefined,
            signal: AbortSignal.timeout(3000)
        });

        if (response.ok) {
            backendReady = true;
            console.log(`[Startup] OpenCode backend healthy at ${BACKEND_URL}`);
            return;
        }
    } catch {
        // Backend is still warming up.
    }

    if (attempt % 10 === 0) {
        console.log(`[Startup] Waiting for OpenCode backend at ${BACKEND_URL} (${attempt})...`);
    }
    setTimeout(() => waitForBackendReady(attempt + 1), 3000).unref();
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

function shutdown(proxy) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[Startup] Shutdown requested.');
    try { backendProcess?.kill('SIGTERM'); } catch { }
    try { proxy.killBackend?.(); } catch { }
    try { proxy.server?.close(() => process.exit(0)); } catch { process.exit(0); }
    setTimeout(() => process.exit(0), 5000).unref();
}

setupPluginConfig();

console.log(`[Startup] Starting OpenCode2API Proxy immediately on port ${PORT}...`);
console.log(`[Startup] Backend target: ${BACKEND_URL}`);
console.log(`[Startup] Preferred OpenCode binary: ${PREFERRED_BIN}`);

const { startProxy } = await import('./src/proxy.js');

const config = {
    PORT,
    API_KEY: process.env.API_KEY || '',
    OPENCODE_SERVER_URL: BACKEND_URL,
    OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
    MANAGE_BACKEND: false,
    OPENCODE_PATH: PREFERRED_BIN,
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
    installOpencodeBinary();

    process.on('SIGTERM', () => shutdown(proxy));
    process.on('SIGINT', () => shutdown(proxy));

    setInterval(() => {
        console.log(`[Startup] Supervisor status: proxy=online backend=${backendReady ? 'healthy' : backendProcess ? 'starting' : 'offline'} install=${installInProgress ? 'running' : 'idle'}`);
    }, 60000).unref();
} catch (error) {
    console.error('[Fatal] Failed to start proxy:', error);
    process.exit(1);
}
