import { useParams } from 'react-router';

export default function Visualization() {
  const { type } = useParams();
  
  return (
    <div className="prose max-w-none">
      <h1>Visualization</h1>
      <p>Viewing visualization type: {type}</p>
      <p>Visualization content coming soon...</p>
    </div>
  );
}