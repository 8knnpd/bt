@echo off
cd /d "%~dp0"

echo Removing old Git history...
rmdir /s /q .git

echo Initializing fresh Git repository...
git init

echo Adding files...
git add .

echo Committing...
git commit -m "Initial commit"

echo Setting branch to main...
git branch -M main

echo Adding remote...
git remote add origin https://github.com/8knnpd/bt.git

echo Pushing to GitHub (force)...
git push -u origin main --force

echo.
echo Done! Clean upload to GitHub
pause
