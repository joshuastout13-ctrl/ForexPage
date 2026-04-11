import React, { useState, useEffect, useCallback } from 'react';

interface CurrencyPair {
  pair: string;
  price: string;
  change: string;
  changePercent: string;
  high: string;
  low: string;
  flag: string;
}

const SAMPLE_DATA: CurrencyPair[] = [
  { pair: 'EUR/USD', price: '1.0872', change: '+0.0023', changePercent: '+0.21%', high: '1.0895', low: '1.0841', flag: '🇪🇺🇺🇸' },
  { pair: 'GBP/USD', price: '1.2634', change: '-0.0018', changePercent: '-0.14%', high: '1.2670', low: '1.2610', flag: '🇬🇧🇺🇸' },
  { pair: 'USD/JPY', price: '151.42', change: '+0.35', changePercent: '+0.23%', high: '151.80', low: '150.95', flag: '🇺🇸🇯🇵' },
  { pair: 'USD/CHF', price: '0.8821', change: '-0.0012', changePercent: '-0.14%', high: '0.8845', low: '0.8805', flag: '🇺🇸🇨🇭' },
  { pair: 'AUD/USD', price: '0.6543', change: '+0.0031', changePercent: '+0.48%', high: '0.6560', low: '0.6510', flag: '🇦🇺🇺🇸' },
  { pair: 'USD/CAD', price: '1.3642', change: '+0.0015', changePercent: '+0.11%', high: '1.3665', low: '1.3620', flag: '🇺🇸🇨🇦' },
  { pair: 'NZD/USD', price: '0.6012', change: '-0.0008', changePercent: '-0.13%', high: '0.6035', low: '0.5998', flag: '🇳🇿🇺🇸' },
  { pair: 'EUR/GBP', price: '0.8606', change: '+0.0014', changePercent: '+0.16%', high: '0.8625', low: '0.8590', flag: '🇪🇺🇬🇧' },
];

const addVariation = (data: CurrencyPair[]): CurrencyPair[] => {
  return data.map((item) => {
    const basePrice = parseFloat(item.price);
    const variation = (Math.random() - 0.5) * 0.002 * basePrice;
    const newPrice = basePrice + variation;
    const change = variation;
    const changePercent = (variation / basePrice) * 100;

    const decimals = item.price.includes('.') ? item.price.split('.')[1].length : 2;

    return {
      ...item,
      price: newPrice.toFixed(decimals),
      change: (change >= 0 ? '+' : '') + change.toFixed(decimals),
      changePercent: (changePercent >= 0 ? '+' : '') + changePercent.toFixed(2) + '%',
    };
  });
};

const Dashboard: React.FC = () => {
  const [pairs, setPairs] = useState<CurrencyPair[]>(SAMPLE_DATA);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString());
  const [loading, setLoading] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.REACT_APP_API_URL;
      if (apiUrl) {
        const response = await fetch(`${apiUrl}/forex/pairs`);
        if (response.ok) {
          const data = await response.json();
          setPairs(data);
          setLastUpdated(new Date().toLocaleTimeString());
          setLoading(false);
          return;
        }
      }
    } catch {
      // Backend not available, use sample data with variation
    }
    setPairs(addVariation(SAMPLE_DATA));
    setLastUpdated(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const gainers = pairs.filter((p) => p.change.startsWith('+')).length;
  const losers = pairs.length - gainers;

  return (
    <div className="dashboard">
      <div className="summary-section">
        <div className="summary-card">
          <h3>Total Pairs</h3>
          <div className="value">{pairs.length}</div>
        </div>
        <div className="summary-card">
          <h3>Gainers</h3>
          <div className="value" style={{ color: '#00e676' }}>{gainers}</div>
        </div>
        <div className="summary-card">
          <h3>Losers</h3>
          <div className="value" style={{ color: '#ff5252' }}>{losers}</div>
        </div>
        <div className="summary-card">
          <h3>Last Updated</h3>
          <div className="value" style={{ fontSize: '1rem' }}>{lastUpdated}</div>
        </div>
      </div>

      <div className="refresh-row">
        <div>
          <h2 className="dashboard-title">Currency Pairs</h2>
          <p className="dashboard-subtitle">Live market overview &bull; Updates every 30 seconds</p>
        </div>
        <button className="refresh-btn" onClick={fetchData} disabled={loading}>
          {loading ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      <div className="currency-grid">
        {pairs.map((pair) => {
          const isPositive = pair.change.startsWith('+');
          return (
            <div className="currency-card" key={pair.pair}>
              <div className="card-header">
                <span className="pair-name">{pair.pair}</span>
                <span className="pair-flag">{pair.flag}</span>
              </div>
              <div className="card-price">{pair.price}</div>
              <div className="card-details">
                <span className={isPositive ? 'change-positive' : 'change-negative'}>
                  {pair.change} ({pair.changePercent})
                </span>
              </div>
              <div className="card-row">
                <span><span className="detail-label">H: </span><span className="detail-value">{pair.high}</span></span>
                <span><span className="detail-label">L: </span><span className="detail-value">{pair.low}</span></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Dashboard;
