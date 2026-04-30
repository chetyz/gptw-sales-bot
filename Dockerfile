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
CMD ["bash", "-lc", "tmux new-session -d -s bot; sleep 2; tmux send-keys -t bot 'claude --model sonnet --dangerously-skip-permissions --dangerously-load-development-channels server:gptw-sales-bot' Enter; tail -f /dev/null"]
