import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

const distPath = join(__dirname, 'build');
const indexPath = join(distPath, 'index.html');

// Check if dist directory and index.html exist
if (!fs.existsSync(distPath)) {
  console.error('Error: dist directory not found at:', distPath);
  console.log('Current directory contents:', fs.readdirSync(__dirname));
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  console.error('Error: index.html not found at:', indexPath);
  console.log('dist directory contents:', fs.readdirSync(distPath));
  process.exit(1);
}

// Serve static files from the dist directory
app.use(express.static(distPath));

// For client-side routing, send index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(indexPath);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('Serving files from:', distPath);
}); 