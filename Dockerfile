FROM node:20-alpine AS development-dependencies-env
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

FROM node:20-alpine AS production-dependencies-env
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS build-env
WORKDIR /app
COPY --from=development-dependencies-env /app/node_modules ./node_modules
COPY . .
RUN npm run build || (echo "Build failed" && ls -la && exit 1)

FROM node:20-alpine
WORKDIR /app
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY --from=build-env /app/dist ./dist
COPY package.json ./
COPY server.js ./

# Add express for serving static files
RUN npm install express@4

EXPOSE 3000
CMD ["node", "server.js"]