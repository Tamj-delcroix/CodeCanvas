# CodeCanvas

Stage 1: Foundation scaffold for the full-stack browser code playground.

## Included
- Vite frontend and responsive dark navy/cyan/purple foundation UI
- Express API server and health endpoints
- Socket.IO gateway scaffold (no editing events enabled yet)
- MySQL environment configuration and initial database creation SQL

## Not implemented yet
Authentication, database connection/persistence, project CRUD, Monaco Editor, live preview execution, autosave, import/export, and real-time editing are later stages.

## Requirements
Node.js 20+ recommended and npm. MySQL will be needed when Stage 2 implements persistence.

## Run on Windows / Git Bash
1. Open the folder in VS Code.
2. Copy `.env.example` to `.env`.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:5173`.
6. Test API at `http://localhost:3000/api/health`.

`/api/ready` currently reports `database: not-connected-yet`; this is expected at Stage 1.

## Commands
- `npm run dev` — start frontend and backend
- `npm run build` — build frontend
- `npm start` — start API server

Never commit `.env` or real credentials. User-authored code must run in an isolated sandbox when preview execution is implemented.
