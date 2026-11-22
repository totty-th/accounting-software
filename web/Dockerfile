# ระบบบัญชี — image สำหรับ Coolify/VPS (build จากโฟลเดอร์ web/)
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Bangkok
RUN apk add --no-cache tzdata
COPY --from=build /app ./
EXPOSE 3000
# apply migration ใหม่ก่อนเปิดเว็บ (ล้ม = ไม่เปิด เพื่อไม่ให้โค้ดใหม่วิ่งบนฐานเก่า)
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node_modules/.bin/next start -p 3000"]
