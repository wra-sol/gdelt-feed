FROM node:20-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:20-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:20-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/dist /app/dist
COPY package.json /app/

# Add a simple express server to serve the static files
RUN npm install express@4
COPY server.js /app/
EXPOSE 3000
CMD ["node", "server.js"]