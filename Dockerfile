FROM node:23-alpine3.20 AS builder

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies & clean up
RUN npm install --production && npm cache clean --force

# Copy the application code
COPY . .

# Create a smaller production image
FROM node:23-alpine3.20

# Set non-root user for better security (using a different GID/UID)
RUN addgroup -g 1001 nodeuser && \
    adduser -u 1001 -G nodeuser -s /bin/sh -D nodeuser

WORKDIR /app

# Add metadata to the image
LABEL org.opencontainers.image.title="full-stack-ai-content-generator-discord-bot"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.description="https://github.com/TryFailTryAgain/Full-Stack-AI-Content-Generator-Discord-Bot"

# Copy only the necessary files from the builder stage
COPY --from=builder --chown=nodeuser:nodeuser /app .

# Ensure the Outputs directory exists and is owned by nodeuser
RUN mkdir -p /app/Outputs && chown -R nodeuser:nodeuser /app/Outputs

# Switch to non-root user
USER nodeuser

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]