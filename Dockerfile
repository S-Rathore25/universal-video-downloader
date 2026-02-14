FROM node:20-slim

# Install ffmpeg (required for merging video/audio formats)
RUN apt-get update && apt-get install -y ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port
ENV PORT=3000
EXPOSE 3000

# Start command
CMD [ "node", "server/server.js" ]
