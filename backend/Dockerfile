# ---- build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY seeds ./seeds
EXPOSE 4000
# apply pending migrations, then start the API
CMD ["sh", "-c", "node dist/cli/migrate.js && node dist/main.js"]
