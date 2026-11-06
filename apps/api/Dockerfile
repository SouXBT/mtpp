FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npx nest build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
COPY assets ./assets
EXPOSE 3000
# migrasi Prisma dijalankan setiap kali backend dinyalakan, lalu data awal diisi otomatis bila kosong
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
