#!/usr/bin/env bash
# 管理员首次执行：安装固定命令入口；参数只接受部署公钥文件与现有源码目录。
# sudo bash deploy/scripts/install-github-deploy.sh /root/amie-ci.pub /home/codex/projects/amie
set -Eeuo pipefail
umask 077
[ "$(id -u)" = 0 ] || { echo 'root required' >&2; exit 1; }
[ "$#" = 2 ] || { echo 'usage: install-github-deploy.sh PUBLIC_KEY EXISTING_SOURCE' >&2; exit 1; }
public_key="$1"
source_dir="$(cd "$2" && pwd)"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ssh-keygen -l -f "$public_key" >/dev/null
[ "$(wc -l < "$public_key")" -eq 1 ] && grep -Eq '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$' "$public_key"
command -v sudo >/dev/null
command -v python3 >/dev/null

# 不覆盖来源不明的同名账户、SSH 入口或其他配置。
if id amie-deploy >/dev/null 2>&1; then
  echo 'amie-deploy already exists; inspect the installed configuration before changing it' >&2
  exit 1
fi
for file in /usr/local/sbin/amie-github-deploy /etc/amie/github-deploy.json /usr/local/libexec/amie-ci-ssh /etc/sudoers.d/amie-github-deploy; do
  [ ! -e "$file" ] || { echo "already exists: $file" >&2; exit 1; }
done

useradd --system --user-group --create-home --home-dir /home/amie-deploy --shell /bin/sh amie-deploy
passwd -l amie-deploy >/dev/null
install -d -m 0700 /etc/amie
install -d -m 0755 /usr/local/libexec
install -m 0755 "$script_dir/github-deploy.py" /usr/local/sbin/amie-github-deploy
cat > /etc/amie/github-deploy.json <<'JSON'
{
  "repo": "ayisuplus/cyber-sister",
  "branch": "master",
  "managed_root": "/opt/amie/cicd",
  "state_dir": "/opt/amie",
  "runtime_env": "/opt/amie/runtime.env"
}
JSON
chmod 0600 /etc/amie/github-deploy.json
cat > /usr/local/libexec/amie-ci-ssh <<'SH'
#!/bin/sh
[ "${SSH_ORIGINAL_COMMAND:-}" = deploy ] || exit 64
exec /usr/bin/sudo -n /usr/local/sbin/amie-github-deploy
SH
chmod 0755 /usr/local/libexec/amie-ci-ssh
cat > /etc/sudoers.d/amie-github-deploy <<'SUDO'
Defaults:amie-deploy !lecture
amie-deploy ALL=(root) NOPASSWD: /usr/local/sbin/amie-github-deploy ""
SUDO
chmod 0440 /etc/sudoers.d/amie-github-deploy
visudo -cf /etc/sudoers.d/amie-github-deploy >/dev/null
install -d -o amie-deploy -g amie-deploy -m 0700 /home/amie-deploy/.ssh
{ printf 'restrict,command="/usr/local/libexec/amie-ci-ssh" '; cat "$public_key"; } > /home/amie-deploy/.ssh/authorized_keys
chown amie-deploy:amie-deploy /home/amie-deploy/.ssh/authorized_keys
chmod 0600 /home/amie-deploy/.ssh/authorized_keys
if command -v restorecon >/dev/null; then restorecon -R /home/amie-deploy/.ssh; fi

# 只登记旧版源码上下文与镜像标签，不构建、不迁移、不切换正在运行的服务。
/usr/local/sbin/amie-github-deploy --init "$source_dir"
echo 'Installed the restricted GitHub deployment entry point.'
