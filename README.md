# CodeCanvas

**A browser-based coding workspace for building and previewing web projects.**

CodeCanvas is a web development playground that brings code editing, project management, and live preview into one workspace. It is built to provide a convenient environment for writing and testing HTML, CSS, and JavaScript directly in the browser.

## Features

- **Account Authentication** — Register, log in, and manage access to your workspace.
- **Project Management** — Create, open, edit, and manage web projects.
- **Monaco Code Editor** — Write HTML, CSS, and JavaScript with a dedicated code editor.
- **Live Preview** — Run your code and inspect the result in an embedded preview.
- **Split Workspace** — Work with the editor and preview side by side, with an option to hide or show the preview.
- **Save & Autosave** — Save project changes and retain code between sessions.
- **Console Output** — Inspect JavaScript console messages from the preview.

## Tech Stack

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript | Frontend interface |
| Vite | Frontend development server and build tool |
| Monaco Editor | Code editing experience |
| Node.js | JavaScript runtime |
| Express | Backend API and application server |
| MySQL | Persistent application data |
| Express Session | Session-based authentication |
| Socket.IO | Real-time communication infrastructure |

## Project Structure

```text
CodeCanvas/
├── db/
│   └── schema.sql
├── server/
│   └── index.js
├── src/
│   ├── main.js
│   ├── style.css
│   └── stage4.css
├── index.html
├── vite.config.js
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js and npm
- MySQL Server
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Tamj-delcroix/CodeCanvas.git
cd CodeCanvas
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root. Use the environment variable names expected by `server/index.js`.

```env
PORT=3000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173

SESSION_SECRET=replace_with_a_random_secret_of_at_least_32_characters

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_mysql_username
DB_PASSWORD=your_mysql_password
DB_NAME=codecanvas
```

Replace the example values with your local configuration. Use a unique, randomly generated session secret. Never commit `.env` or expose database credentials.

### 4. Set up the database

Create the MySQL database configured by `DB_NAME`, then import or execute the SQL schema from `db/schema.sql` using your preferred MySQL client.

### 5. Run the application

Start the frontend and backend using the scripts defined in `package.json`. Check the available scripts before running them:

```bash
npm run
```

Use the appropriate frontend development and backend start scripts listed in the output. The default frontend origin configured for the backend is `http://localhost:5173`.

### 6. Open CodeCanvas

Open the local frontend URL displayed by Vite in your terminal. Make sure the backend and MySQL server are running and configured correctly.

## Environment & Security Notes

- Keep `.env` out of version control.
- Use strong, unique credentials and a random session secret.
- Configure `CLIENT_ORIGIN` to match the frontend origin.
- For production, use HTTPS and configure secure cookies and deployment environment variables appropriately.
- Review the preview sandbox and security settings before accepting untrusted code in a public deployment.

## Current Scope

CodeCanvas focuses on a browser-based workspace for editing and previewing HTML, CSS, and JavaScript projects.

The repository contains the application source code and database schema. Production hosting, database provisioning, and deployment configuration may require additional setup.

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Make and test your changes.
4. Submit a pull request describing the changes.

## License

No license has been specified yet. All rights remain with the respective copyright holder unless a license is added to this repository.
