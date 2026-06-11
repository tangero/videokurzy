# FIO proxy — viz server.js (relay kvůli CF Workers 525 / FIO bez ALPN).
FROM node:22-alpine

WORKDIR /app

# Nejdřív manifesty kvůli docker layer cache.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
