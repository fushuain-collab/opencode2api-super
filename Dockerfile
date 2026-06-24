FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=80 \
    OPENCODE_BINARY_VERSION=1.17.9 \
    OPENCODE_RUNTIME_DIR=/opt/opencode-runtime \
    OPENCODE_PATH=/opt/opencode-runtime/node_modules/opencode-linux-x64/bin/opencode \
    npm_config_update_notifier=false \
    npm_config_progress=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

RUN mkdir -p /opt/opencode-runtime \
    && npm install opencode-linux-x64@${OPENCODE_BINARY_VERSION} \
        --ignore-scripts \
        --no-audit \
        --no-fund \
        --omit=dev \
        --no-package-lock \
        --prefix /opt/opencode-runtime \
    && chmod +x /opt/opencode-runtime/node_modules/opencode-linux-x64/bin/opencode \
    && /opt/opencode-runtime/node_modules/opencode-linux-x64/bin/opencode --version

COPY . .

EXPOSE 80
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "start.js"]
