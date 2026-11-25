FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src/
COPY public ./public/
USER node
EXPOSE 8080
ENV PORT=8080
ENV PULSE_CHECKPOINT=/tmp/pulse-last-good.json
CMD ["node", "src/server.mjs"]
