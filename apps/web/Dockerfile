# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @contenter/web --workspace @contenter/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @contenter/shared && npm run build -w @contenter/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# files copied from `public/` keep the checkout's mode (a 077 umask on the server makes them 600,
# which nginx answers with 403 while generated assets stay readable)
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
