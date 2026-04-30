#!/bin/bash
# Entrypoint del bot — restaura estado de Claude Code y arranca.
#
# Por qué: claude guarda `hasCompletedOnboarding` en /root/.claude.json
# (fuera del volumen /root/.claude/). Sin esto, cada deploy reinicia
# el container y pide OAuth, theme, trust-folder de nuevo. Solución:
# /root/.claude.json es un symlink al archivo real en el volumen.
set -e

VOL=/root/.claude
STATE_FILE=$VOL/_claude.json
LIVE_FILE=/root/.claude.json

mkdir -p "$VOL"

# Restaurar archivo de estado desde volumen al path que claude espera.
if [ -f "$STATE_FILE" ]; then
    rm -f "$LIVE_FILE"
    ln -sf "$STATE_FILE" "$LIVE_FILE"
else
    # Primer arranque: claude va a crear el archivo. Lo dejamos donde
    # claude espera, y al terminar el OAuth lo movemos al volumen
    # con un watcher en background.
    rm -f "$LIVE_FILE"
    touch "$LIVE_FILE"
fi

# Watcher: si claude crea/modifica /root/.claude.json (no el symlink),
# lo movemos al volumen y reemplazamos por symlink. Solo aplica si
# todavía no existe el archivo en el volumen.
(
    while true; do
        sleep 30
        if [ ! -L "$LIVE_FILE" ] && [ -f "$LIVE_FILE" ] && [ -s "$LIVE_FILE" ]; then
            cp "$LIVE_FILE" "$STATE_FILE"
            rm "$LIVE_FILE"
            ln -sf "$STATE_FILE" "$LIVE_FILE"
            echo "[entrypoint] Migrated .claude.json to volume"
        fi
        # Si es symlink, sincronizar el archivo real del volumen
        # (claude puede haber escrito cambios)
        if [ -L "$LIVE_FILE" ] && [ -f "$STATE_FILE" ]; then
            : # ya está sincronizado vía symlink, no hacer nada
        fi
    done
) &

# Lanzar Claude Code dentro de tmux.
tmux new-session -d -s bot bash
sleep 1
tmux send-keys -t bot 'claude --model sonnet --dangerously-skip-permissions --dangerously-load-development-channels server:gptw-sales-bot' Enter
sleep 20
# Enter para confirmar el banner de "Loading development channels"
# (sólo aparece si onboarding ya estaba completo; si no, los Enters
# extra van al chat principal y no rompen nada).
tmux send-keys -t bot Enter

# Mantener el container vivo.
tail -f /dev/null
