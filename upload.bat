@echo off
cd /d "%~dp0"
git add .
git commit -m "Clean project - removed docs"
git push -u origin main --force
echo Done!
pause
