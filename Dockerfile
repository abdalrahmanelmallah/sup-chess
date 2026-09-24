# Step 1: Use an official Node.js image
FROM node:22-slim

# Step 2: Set the working directory
WORKDIR /app

# Step 3: Copy everything into the image
COPY . .

# Step 4: Install and build the frontend
RUN cd frontend && npm install && npm run build

# Step 5: Install backend dependencies
RUN cd backend && npm install

# Step 6: Expose the port the app runs on
EXPOSE 5001

# Step 7: The command to start the app
CMD ["sh", "-c", "cd backend && node server.js"]
