FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run ui:build

ENV NODE_ENV=production
ENV PORT=7860
ENV DATA_DIR=/data

EXPOSE 7860

CMD ["npm", "run", "hf:server"]
