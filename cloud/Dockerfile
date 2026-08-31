# Il server cloud di STARK. Gira su Node 24 (esegue i .ts nativamente, senza build).
# Non ha dipendenze npm: usa solo i moduli built-in di Node (http, crypto, fs).
FROM node:24-alpine

WORKDIR /app

# Solo il server cloud serve: il resto del repo non entra nel container.
COPY src/cloud ./src/cloud

ENV PORT=8787
EXPOSE 8787

CMD ["node", "src/cloud/server.ts"]
