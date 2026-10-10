# Imagen para pruebas locales (docker-compose.local.yml). En AWS la app corre directo en la EC2 con PM2.
FROM node:20-alpine
WORKDIR /app
COPY app/package.json ./
RUN npm install --omit=dev
COPY app/src ./src
COPY app/public ./public
COPY app/scripts ./scripts
COPY database /database
EXPOSE 3000
CMD ["node", "src/server.js"]
