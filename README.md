# ForexPage

A modern forex investment dashboard built with React and Node.js.

## Features
- Real-time forex data visualization
- Investment tracking and analytics
- Responsive dashboard interface
- RESTful API backend

## Tech Stack
- **Frontend**: React, TypeScript, CSS
- **Backend**: Node.js, Express
- **Database**: Ready for integration

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

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

4. Create environment file:
```bash
cp .env.example .env
```

5. Update .env with your configuration

### Running the Application

**Frontend (Development):**
```bash
npm start
```
Runs on http://localhost:3000

**Backend (Development):**
```bash
cd server
npm start
```
Runs on http://localhost:5000

## Project Structure
```
ForexPage/
├── public/              # Static assets
├── src/                 # React components
│   ├── components/      # Reusable components
│   ├── pages/          # Page components
│   ├── App.tsx         # Main app component
│   └── index.tsx       # Entry point
├── server/             # Node.js/Express backend
│   ├── routes/         # API routes
│   ├── controllers/     # Request handlers
│   └── server.js       # Express setup
├── README.md
├── package.json
└── .env.example

```

## Contributing
1. Create a feature branch
2. Make your changes
3. Submit a pull request

## License
MIT
