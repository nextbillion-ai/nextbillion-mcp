# syntax=docker/dockerfile:1
# Hosted (Streamable HTTP) build of nextbillion-mcp. The runtime image holds only the
# bundled single-file server and its documentation index; no npm install at runtime.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/server ./packages/server
RUN npm run build --workspace packages/server

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/server/data ./data
USER node
EXPOSE 8080
# NBAI_PUBLIC_URL (default https://mcp.nextbillion.io) must match the URL users enter.
CMD ["node", "dist/index.js", "--http"]
