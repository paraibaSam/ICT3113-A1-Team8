FROM node:20-alpine

WORKDIR /app

# Install dependencies first so `npm install` is only re-run when
# package.json actually changes (Docker layer caching).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
