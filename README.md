# ForexPage

A modern forex investment dashboard built with React and Node.js.

## Features

- Real-time forex currency pair data
- Auto-refreshing dashboard (every 30 seconds)
- Responsive dark-themed UI
- RESTful API backend with Express
- Summary cards for gainers/losers

## Tech Stack

- **Frontend**: React 18, TypeScript, CSS
- **Backend**: Node.js, Express

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/joshuastout13-ctrl/ForexPage.git
cd ForexPage
```

2. Install frontend dependencies:
```bash
npm install
```

3. Install backend dependencies:
```bash
cd server
npm install
cd ..
```

4. (Optional) Create an environment file:
```bash
cp .env.example .env
```

### Running the Application

**Frontend (Development):**
```bash
npm start
```
Opens at http://localhost:3000

**Backend (Development):**
Open a second terminal and run:
```bash
cd server
npm start
```
Runs at http://localhost:5000

The frontend works standalone with sample data. When the backend is running, it fetches data from the API instead.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/forex/pairs` | Get all currency pairs |
| GET | `/api/forex/pairs/:pair` | Get a specific pair (e.g. `EUR-USD`) |
| GET | `/api/health` | Health check |

## Project Structure

```
ForexPage/
├── public/
│   └── index.html           # HTML entry point
├── src/
│   ├── components/
│   │   └── Dashboard.tsx     # Forex dashboard component
│   ├── App.tsx               # Main app component
│   ├── App.css               # Styles
│   ├── index.tsx             # React entry point
│   └── react-app-env.d.ts   # TypeScript declarations
├── server/
│   ├── controllers/
│   │   └── forexController.js  # Request handlers
│   ├── routes/
│   │   └── forexRoutes.js      # API routes
│   ├── server.js               # Express server
│   └── package.json
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
