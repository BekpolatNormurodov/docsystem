@echo off
REM Windows Task Scheduler wrapper: retry BRIGHT billing-invoice sync until billing is up.
cd /d "C:\Users\JONIBEK\Desktop\docsystem"
"C:\Program Files\nodejs\npx.cmd" tsx scripts\billing-invoice-retry.ts
