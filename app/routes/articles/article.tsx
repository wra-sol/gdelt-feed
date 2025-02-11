import { useParams } from 'react-router';

export default function Article() {
  const { id } = useParams();
  
  return (
    <div className="prose max-w-none">
      <h1>Article Details</h1>
      <p>Viewing article ID: {id}</p>
      <p>Article content coming soon...</p>
    </div>
  );
}