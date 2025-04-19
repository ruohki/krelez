# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY bun.lock ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Set environment variables for build
ENV NODE_ENV=production

# Build the application
RUN npm run build

# Runtime stage
FROM node:20-slim

WORKDIR /app

# Copy the built application
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json

# Set runtime environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# Expose the port the app runs on
EXPOSE 4321

# Start the application
CMD ["node", "./dist/server/entry.mjs"]
