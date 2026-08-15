/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone 产物便于 Docker 部署（见 Dockerfile）
  output: 'standalone',
};

export default nextConfig;
