FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source files and build
COPY . .
RUN npm run build

# Install express for serving
RUN npm install express@4

EXPOSE 3000
CMD ["node", "server.js"]