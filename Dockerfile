FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/team-fortune-bot.sqlite
COPY package*.json ./
RUN npm ci --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
COPY assets ./assets
# root 실행을 피하고, 볼륨이 처음 만들어질 때 node 사용자가 DB를 쓸 수 있게 한다
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3978
CMD ["node", "dist/index.js"]
