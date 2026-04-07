FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run ui:build

ENV NODE_ENV=production
ENV PORT=7860
ENV DATA_DIR=/data

EXPOSE 7860

CMD ["npm", "run", "hf:server"]
