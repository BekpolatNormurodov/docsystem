@echo off
REM Wrapper for the Windows Task Scheduler: run the single-shot cabinet TTL check.
cd /d "C:\Users\JONIBEK\Desktop\docsystem"
"C:\Program Files\nodejs\npx.cmd" tsx scripts\cabinet-ttl-check.ts
