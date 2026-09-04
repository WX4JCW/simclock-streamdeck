@echo off
REM Starts the Sim Clock bridge so the plugin's "Sim Zulu" source has data.
REM Leave this window open while flying; close it to stop.
cd /d "%~dp0"
py -3.12 simclock_bridge.py
pause
