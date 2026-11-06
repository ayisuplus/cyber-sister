#!/usr/bin/env bash
# 在已批准的 AlmaLinux 9 主机上安装本项目需要的 Docker；不变更 SSH、现有代理或用户组。
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo '请以 root 执行' >&2; exit 1; }
# shellcheck source=/dev/null
source /etc/os-release
[ "${ID:-}" = almalinux ] && [ "${VERSION_ID%%.*}" = 9 ] \
  || { echo '此脚本只用于本次核查的 AlmaLinux 9 主机' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo '主机架构与核查结果不一致' >&2; exit 1; }

if ! command -v docker >/dev/null; then
  # 不自动卸载容器平台或运行时，避免影响主机上其他服务。
  for package in podman podman-docker docker docker-engine runc; do
    if rpm -q "$package" >/dev/null 2>&1; then
      echo "已有 $package；请先人工核对，不自动移除" >&2
      exit 1
    fi
  done
  dnf -y install dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker
docker version --format 'Docker server: {{.Server.Version}}'
docker compose version
docker run --rm hello-world
rpm -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
echo 'Docker 与 Compose 安装验证完成；未修改现有 SSH、代理服务或用户组。'
