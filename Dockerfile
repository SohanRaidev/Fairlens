# Use an official Node.js runtime as a parent image
FROM node:18-bullseye-slim

# Install Python 3, pip, and SQLite
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv sqlite3 && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Create a virtual environment for Python to avoid PEP 668 issues
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application code
COPY . .



EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
