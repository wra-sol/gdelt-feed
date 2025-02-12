FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source files and build
COPY . .

# Debug the build process
RUN echo "Starting build..." && \
    echo "Current directory:" && \
    pwd && \
    echo "Directory contents before build:" && \
    ls -la && \
    npm run build && \
    echo "Directory contents after build:" && \
    ls -la && \
    echo "Build complete"

# Install express for serving
RUN npm install express@4

EXPOSE 3000
CMD ["node", "server.js"]