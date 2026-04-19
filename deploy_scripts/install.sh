#!/bin/bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip iptables-persistent git gh net-tools
python3 -m venv ~/venv
if ! grep -q "alias venv=" ~/.bash_aliases; then
    echo 'alias venv="source ~/venv/bin/activate"' >> ~/.bash_aliases
fi
source ~/venv/bin/activate
pip install --upgrade pip

echo "Adding port 8080 to firewall rules..."
sudo iptables -D INPUT 6
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
sudo iptables -L INPUT -n --line-numbers
read -p "Provide host IP address? " HOST_IP
HOST_IP=${HOST_IP:-127.0.0.1}
echo "Using IP: $HOST_IP"
read -p "Provide port (default 8080): " HOST_PORT
HOST_PORT=${HOST_PORT:-8080}
echo "Using port: $HOST_PORT"

mkdir ~/projects && cd ~/projects
touch ~/.github_token && chmod 600 ~/.github_token
echo -e "Please visit\n\n\thttps://github.com/settings/tokens\n\nand enter your GitHub token (with repo access) and press Enter:"
read -s GITHUB_TOKEN
echo $GITHUB_TOKEN > ~/.github_token
if [ -f ~/.github_token ]; then
    gh auth login -p https --with-token < ~/.github_token
else
    gh auth login
fi
gh repo clone piotrek1488/animesub-stremio || exit 1
pip install -r ~/projects/animesub-stremio/requirements.txt || exit 1
export BASE_URL="http://${HOST_IP}:${HOST_PORT}"


echo "Creating systemd service file..."
sudo tee /etc/systemd/system/animesub.service > /dev/null <<EOL
[Unit]
Description=AnimeSub.info Stremio Addon
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${HOME}/projects/animesub-stremio
Environment=BASE_URL=http://${HOST_IP}:${HOST_PORT}
ExecStart=${HOME}/venv/bin/uvicorn main:app --host 0.0.0.0 --port ${HOST_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOL

echo "Starting the addon..."
sudo systemctl daemon-reload
sudo systemctl enable animesub
sudo systemctl start animesub
sudo systemctl status animesub --no-pager

(crontab -l 2>/dev/null; echo "*/10 * * * * /bin/bash -c 'dd if=/dev/urandom bs=1k count=1 2>/dev/null | md5sum > /dev/null'") | crontab -

echo -e "Check if you can reach manifest URL:\n\n\thttp://${HOST_IP}:${HOST_PORT}/manifest.json\n"
