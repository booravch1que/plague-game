FROM node:22-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
RUN corepack enable
COPY . .
# Dev dependencies are needed for the Vite build.
RUN pnpm install --prod=false && pnpm build
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
