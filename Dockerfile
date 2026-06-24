FROM node:20-slim

# Install opencode globally
RUN npm install -g opencode-ai

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Build the system prompt
RUN mkdir -p /home/node/.config/opencode/plugin/opencode2api-empty && \
    echo 'export const Opencode2apiEmptyPlugin = async () => ({})
export default Opencode2apiEmptyPlugin' > /home/node/.config/opencode/plugin/opencode2api-empty/index.js && \
    echo '{
  "plugin": ["/home/node/.config/opencode/plugin/opencode2api-empty/index.js"],
  "instructions": [],
  "theme": "system"
}' > /home/node/.config/opencode/opencode.json

ENV NODE_ENV=production

EXPOSE 80

CMD ["node", "start.js"]