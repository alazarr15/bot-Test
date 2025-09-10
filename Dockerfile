# Start from a Node.js image
FROM node:20

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy app source code
COPY . .

# Explicitly set execute permissions for nodemon
# This is the line that will fix your "Permission denied" error
RUN chmod +x ./node_modules/.bin/nodemon

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ]