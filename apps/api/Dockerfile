# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# schema is needed by the api's postinstall (prisma generate)
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace @contenter/api --workspace @contenter/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @contenter/shared && npm run build -w @contenter/api

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4000
# APP_ROLE=api runs migrations then serves HTTP; APP_ROLE=worker only consumes the queue.
CMD ["sh", "-c", "if [ \"$APP_ROLE\" != \"worker\" ]; then npx -w @contenter/api prisma migrate deploy; fi && node apps/api/dist/main.js"]
