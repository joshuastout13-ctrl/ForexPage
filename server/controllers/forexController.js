// Sample forex data — replace with a live API integration later
const currencyPairs = [
  { pair: 'EUR/USD', price: '1.0872', change: '+0.0023', changePercent: '+0.21%', high: '1.0895', low: '1.0841', flag: '🇪🇺🇺🇸' },
  { pair: 'GBP/USD', price: '1.2634', change: '-0.0018', changePercent: '-0.14%', high: '1.2670', low: '1.2610', flag: '🇬🇧🇺🇸' },
  { pair: 'USD/JPY', price: '151.42', change: '+0.35',   changePercent: '+0.23%', high: '151.80', low: '150.95', flag: '🇺🇸🇯🇵' },
  { pair: 'USD/CHF', price: '0.8821', change: '-0.0012', changePercent: '-0.14%', high: '0.8845', low: '0.8805', flag: '🇺🇸🇨🇭' },
  { pair: 'AUD/USD', price: '0.6543', change: '+0.0031', changePercent: '+0.48%', high: '0.6560', low: '0.6510', flag: '🇦🇺🇺🇸' },
  { pair: 'USD/CAD', price: '1.3642', change: '+0.0015', changePercent: '+0.11%', high: '1.3665', low: '1.3620', flag: '🇺🇸🇨🇦' },
  { pair: 'NZD/USD', price: '0.6012', change: '-0.0008', changePercent: '-0.13%', high: '0.6035', low: '0.5998', flag: '🇳🇿🇺🇸' },
  { pair: 'EUR/GBP', price: '0.8606', change: '+0.0014', changePercent: '+0.16%', high: '0.8625', low: '0.8590', flag: '🇪🇺🇬🇧' },
];

/** Max ±0.1% random price variation to simulate live market movement */
const VARIATION_FACTOR = 0.002;

// Add small random variation to simulate live data
function addVariation(data) {
  return data.map((item) => {
    const basePrice = parseFloat(item.price);
    const variation = (Math.random() - 0.5) * VARIATION_FACTOR * basePrice;
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
}

// Controller: get all pairs
exports.getPairs = (_req, res) => {
  try {
    const data = addVariation(currencyPairs);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch currency pairs' });
  }
};

// Controller: get a single pair by name (e.g. EUR-USD)
exports.getPairByName = (req, res) => {
  try {
    const pairName = req.params.pair.replace('-', '/').toUpperCase();
    const found = currencyPairs.find((p) => p.pair === pairName);
    if (!found) {
      return res.status(404).json({ error: `Pair ${pairName} not found` });
    }
    const [data] = addVariation([found]);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch currency pair' });
  }
};
