FROM node:20-slim

RUN apt-get update && apt-get install -y xz-utils curl && rm -rf /var/lib/apt/lists/*

# Download opencode binary directly (avoid npm postinstall issues)
RUN set -eux; \
    curl -sL "https://github.com/Glama/open-code/releases/latest/download/opencode-linux-x64.tar.xz" -o /tmp/opencode.tar.xz && \
    tar -xJf /tmp/opencode.tar.xz -C /usr/local/bin/ && \
    rm /tmp/opencode.tar.xz && \
    opencode --version

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN mkdir -p /home/node/.config/opencode/plugin/opencode2api-empty && \
    printf 'export const Opencode2apiEmptyPlugin = async () => ({})\nexport default Opencode2apiEmptyPlugin\n' > /home/node/.config/opencode/plugin/opencode2api-empty/index.js && \
    printf '{\n  "plugin": ["/home/node/.config/opencode/plugin/opencode2api-empty/index.js"],\n  "instructions": [],\n  "theme": "system"\n}\n' > /home/node/.config/opencode/opencode.json

ENV NODE_ENV=production
ENV OPENCODE_SERVER_PORT=10001

EXPOSE 80 10001

ENTRYPOINT ["node", "start.js"]
