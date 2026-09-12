FROM node:20-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build:client
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma db push && npm run prisma:seed && npx tsx server/src/index.ts"]
