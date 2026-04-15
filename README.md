# Stone and Company Forex Fund Investor Portal

A lightweight, serverless investor portal built with HTML, CSS, and Node.js. It integrates with Google Sheets to display real-time and historical performance data.

> [!IMPORTANT]
> **Prototype Status**: This portal is currently a **V1 / Prototype** version. It is designed for ease of use and rapid deployment, but contains specific limitations outlined below.

## Features
- **Modern UI**: Dark-themed dashboard with responsive design.
- **Serverless API**: Fast Node.js functions for authentication and data processing.
- **Zero Dependencies**: Optimized for speed with 0 external npm dependencies.
- **Google Sheets Integration**: Uses Google's `gviz` API for seamless data fetching.

## Getting Started

### Local Development
To run the project locally with the API functions enabled:
1. Ensure you have the [Vercel CLI](https://vercel.com/cli) installed: `npm install -g vercel`.
2. Run the development server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Deployment
The project is configured for Vercel. To deploy changes to production:
```bash
npm run deploy
```

## Configuration
Project settings are located in `lib/config.js`. You can override these using Environment Variables in Vercel:

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_SHEET_ID` | The ID of the Google Sheet containing data | `1uV2CmudSQtmHRaIZTqYDGjWLlmMOcYBCdA1uaL7iMVg` |
| `SESSION_SECRET` | Secret key for signing session cookies | `change-this-secret` |
| `DEFAULT_FUND_YEAR` | The primary year to display in historical returns | `2026` |

### Google Sheets Requirements
The Google Sheet must be set to **"Anyone with the link can view"** for the API to fetch data without an API key.

> [!CAUTION]
> **Security Note**: In this prototype version, investor passwords are stored in **plain-text** within the Google Sheet. This is intended for prototype use only and should be replaced with a secure hashed storage solution for a full production release.

### Maintenance & Scraping
The portal uses a scraping mechanism to fetch live data from Myfxbook.
- **Maintenance**: Changes to the Myfxbook website structure may require updates to `lib/myfxbook.js`.
- **Fallback**: If the scraper fails, the portal will automatically fall back to "Live_Performance" data from the Google Sheet.

## Project Structure
- `/api`: Serverless backend functions (Node.js).
- `/lib`: Common utilities and configuration logic.
- `index.html`: The main dashboard and login interface.
- `vercel.json`: Deployment and routing configuration.
