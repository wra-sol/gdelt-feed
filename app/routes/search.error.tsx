import { useRouteError, isRouteErrorResponse } from "react-router";

export function SearchErrorBoundary() {
  const error = useRouteError();
  
  let errorMessage = "An unexpected error occurred";
  
  if (isRouteErrorResponse(error)) {
    errorMessage = error.data?.message || error.statusText;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Search Error</h1>
      <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
        {errorMessage}
      </div>
      <p className="mt-4">
        Please try again or modify your search query.
      </p>
    </div>
  );
} 