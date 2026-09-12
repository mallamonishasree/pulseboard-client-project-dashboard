FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build:client
ENV NODE_ENV=production
CMD ["npx", "tsx", "server/src/index.ts"]
