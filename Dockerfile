# Use specific Node.js v20 Alpine base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# --- Build Tools (Optional, only if native dependencies need compiling) ---
# Uncomment the next line if you use dependencies like 'bcrypt' (native)
RUN apk add --no-cache python3 make g++

# --- Install curl for health checks ---
# Needed for the 'health-check' script in package.json
RUN apk add --no-cache curl

# --- Install Dependencies using Yarn ---
# Copy package.json AND yarn.lock
COPY package.json yarn.lock ./

# Copy Prisma schema *before* install for better layer caching if schema doesn't change
COPY prisma ./prisma/

# Install dependencies using yarn, ensuring lockfile is respected
# Use --frozen-lockfile (Yarn v1) or --immutable (Yarn v2+)
# This prevents updates and fails if yarn.lock is out-of-sync with package.json
RUN yarn install --frozen-lockfile

# --- Application Setup ---
# Source code will be mounted via docker-compose volume, no need to COPY src here.

# Expose the application port (adjust if your app uses a different port)
EXPOSE 3000

# --- Run Command ---
# Use 'tsx watch' via the 'dev' script for development with hot-reloading
# Use yarn to execute the script defined in package.json
CMD ["yarn", "run", "dev"]