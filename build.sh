#!/bin/bash
set -e

rm -rf dist
mkdir -p dist

# 1. 构建 web (Vue 3 + Vite)
echo "==> Building web..."
cd web
npm install
npm run build -- --outDir ../dist/web
cd ..

# 2. simple-web 是纯静态，直接复制到 web 子目录
echo "==> Copying simple-web..."
cp -r simple-web dist/web/simple-web

# 3. SPA 回退：simple-web 优先，其余走 web 的 index.html
echo "==> Generating _redirects..."
cat > dist/web/_redirects <<'EOF'
/simple-web/*  /simple-web/  200
/*  /  200
EOF

echo "==> Build complete. Output in ./dist/"
ls -la dist/