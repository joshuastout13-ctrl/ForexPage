import React from 'react';
import './App.css';
import Dashboard from './components/Dashboard';

const App: React.FC = () => {
  return (
    <div className="App">
      <header className="App-header">
        <h1>ForexPage</h1>
        <p>Forex Investment Dashboard</p>
      </header>
      <main>
        <Dashboard />
      </main>
      <footer className="App-footer">
        <p>&copy; {new Date().getFullYear()} ForexPage. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;
