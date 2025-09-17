FROM node:18-alpine
WORKDIR /app
COPY session-node/package.json session-node/package-lock.json* ./session-node/
RUN cd session-node && npm ci --only=production || npm install --production
COPY session-node ./session-node
WORKDIR /app/session-node
RUN npm run build || true
EXPOSE 3000
CMD ["npm","start"]
