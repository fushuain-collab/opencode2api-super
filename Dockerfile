FROM node:20-slim

RUN npm install -g opencode-ai

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN mkdir -p /home/node/.config/opencode/plugin/opencode2api-empty && \
    echo 'export const Opencode2apiEmptyPlugin = async () => ({})
export default Opencode2apiEmptyPlugin' > /home/node/.config/opencode/plugin/opencode2api-empty/index.js && \
    echo '{
  "plugin": ["/home/node/.config/opencode/plugin/opencode2api-empty/index.js"],
  "instructions": [],
  "theme": "system"
}' > /home/node/.config/opencode/opencode.json

ENV NODE_ENV=production
ENV OPENCODE_SERVER_PORT=10001

EXPOSE 80 10001

ENTRYPOINT ["node", "start.js"]
