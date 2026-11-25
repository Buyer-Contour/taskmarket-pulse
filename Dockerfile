FROM node:22-alpine
WORKDIR /app
COPY src/data.mjs src/server.mjs ./src/
COPY public ./public/
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "src/server.mjs"]
