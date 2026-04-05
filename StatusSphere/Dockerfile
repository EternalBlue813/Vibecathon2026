FROM node:18-slim

RUN apt-get update && apt-get install -y chromium

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=8080
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 8080
CMD ["npm", "start"]
