@echo off
cd /d "%~dp0.."
railway ssh -- sh -c "cd /app/backend && NODE_PATH=/app/backend/node_modules node /tmp/probe-dp.js"
