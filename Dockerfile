FROM oven/bun:1.1-debian
RUN apt-get update && apt-get install -y curl tmux ca-certificates && \
    curl -fsSL https://claude.ai/install.sh | bash && \
    echo 'export PATH="/root/.local/bin:$PATH"' >> /root/.bashrc && \
    echo 'export PATH="/root/.local/bin:$PATH"' >> /root/.profile
ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY . .
EXPOSE 8787
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
