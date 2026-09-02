# Il server cloud di STARK. Gira su Node 24 (esegue i .ts nativamente, senza build).
# Usa Drizzle ORM + postgres: le dipendenze stanno in cloud/package.json.
FROM node:24-alpine

WORKDIR /app

# Prima le dipendenze (cache del layer): il package.json cambia meno spesso del codice.
COPY cloud/package.json cloud/package-lock.json* ./
RUN npm install --omit=dev --no-fund --no-audit

# Poi il codice del modulo cloud (schema, migrazioni, server).
COPY cloud/src ./src
COPY cloud/drizzle.config.ts ./drizzle.config.ts

ENV PORT=8787
EXPOSE 8787

CMD ["node", "src/server.ts"]
