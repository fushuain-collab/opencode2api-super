FROM node:20-slim

# Install opencode-linux-x64 directly (the native binary package)
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/* && \
    npm install -g opencode-linux-x64@1.17.9 --ignore-scripts && \
    ln -s /usr/local/lib/node_modules/opencode-linux-x64/bin/opencode /usr/local/bin/opencode && \
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
