#!/bin/bash
cd ${HOME}/projects/animesub-stremio
git checkout python
git pull && git rebase
echo "Restarting service..."
PID_BEFORE=$(systemctl show --property MainPID --value animesub)
sudo systemctl restart animesub || exit 1
PID_AFTER=$(systemctl show --property MainPID --value animesub)
if [ "$PID_BEFORE" != "$PID_AFTER" ]; then
    echo "Service restarted successfully. New PID: $PID_AFTER"
else
    sudo systemctl daemon-reload || exit 1
    sudo systemctl restart animesub || exit 1
fi
sudo systemctl status animesub --no-pager