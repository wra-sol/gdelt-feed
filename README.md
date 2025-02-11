# GDELT News Explorer

A real-time news monitoring dashboard that helps you track global news coverage through customizable feeds. Built on the GDELT Project API, it provides instant access to news from over 65 languages with smart article grouping and deduplication.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Key Features

- 📱 **Multi-Column Layout**: Horizontal scrolling feed interface inspired by TweetDeck
- 🔍 **Smart Grouping**: Automatically groups similar articles to reduce noise
- 🌍 **Global Coverage**: News from worldwide sources with country flags and source attribution
- ⚡ **Real-time Updates**: Manual and automatic refresh options
- 🎨 **Dark Mode**: Optimized for low-light viewing
- 💾 **Caching**: Local storage caching with 15-minute freshness

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Visit `http://localhost:5173` and create your first feed column.

## Creating Feed Columns

Each column can be configured with:

- **Query**: GDELT search query (e.g., `climate change sourcelang:english`)
- **Timespan**: `1d`, `7d`, `1m`, or `3m`
- **Sort**: By date or tone (emotional sentiment)
- **Max Records**: Up to 250 articles per refresh

### Query Syntax Examples

```
# Basic keyword search
climate change

# Language-specific
sourcelang:english climate change

# Multiple languages
(sourcelang:english OR sourcelang:spanish) climate

# Domain filtering
domain:bbc.co.uk

# Country filtering
sourcecountry:US election

# Combined filters
"artificial intelligence" sourcelang:english -domain:blogspot.com
```

## Development

```bash
# Type checking
npm run typecheck

# Production build
npm run build

# Preview production build
npm run preview
```

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Routing**: React Router 7
- **Styling**: TailwindCSS
- **Data**: GDELT Project API v2
- **State**: React hooks + Context
- **Caching**: LocalStorage with time-based invalidation

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [GDELT Project](https://www.gdeltproject.org/) for their incredible news API
- Inspired by TweetDeck's multi-column layout
- Built with React Router and TailwindCSS

---

**Note**: This project is not affiliated with the GDELT Project. It's an independent tool that uses their public API.
