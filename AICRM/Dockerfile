# Fast Production Runtime Image for Google Cloud Run
# (Uses pre-built server/dist and client/dist from Stage 3B when available)
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
COPY server/package*.json ./server/
RUN npm install --omit=dev --prefix server

COPY server/dist ./server/dist
COPY client/dist ./client/dist
COPY SPEC.md ./SPEC.md

RUN mkdir -p /app/data /app/logs

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
