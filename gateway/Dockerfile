FROM node:18-bullseye-slim

WORKDIR /app

# Install dependencies needed for node-gyp or prisma if necessary
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies and generate prisma client
RUN npm install

COPY . .

EXPOSE 3001

CMD ["npm", "start"]
