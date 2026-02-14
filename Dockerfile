FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port (must match your app's port)
EXPOSE 3000

# Start command
CMD [ "npm", "start" ]
