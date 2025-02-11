import { Link } from "react-router";

export default function Home() {
  return (
    <div className="prose max-w-none">
      <h1 className="text-2xl font-bold">GDELT News Explorer</h1>
      <p>
        Explore global news coverage and media trends using the GDELT Project's powerful API.
        Search across news content in 65 languages with advanced filtering capabilities.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div className="card">
          <h2>Search Articles</h2>
          <p>Full-text search across global news with filtering by language, country, and more.</p>
          <Link to="/search" className="btn">Start Searching</Link>
        </div>
        
        <div className="card">
          <h2>Visualizations</h2>
          <p>Explore media trends through interactive visualizations and analysis.</p>
          <Link to="/visualizations" className="btn">View Visualizations</Link>
        </div>
      </div>
    </div>
  );
} 