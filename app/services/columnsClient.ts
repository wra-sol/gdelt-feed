import type { ColumnDefinition } from "~/routes/feed"; // Or wherever your interface is

// Utility to safely fetch columns from localStorage
export function getColumnsFromLocalStorage(): ColumnDefinition[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem("myColumns");
  return stored ? JSON.parse(stored) : [];
}

// Utility to add a new column to localStorage
export function addColumnToLocalStorage(newCol: ColumnDefinition): void {
  if (typeof window === "undefined") return;
  const existing = getColumnsFromLocalStorage();
  existing.push(newCol);
  localStorage.setItem("myColumns", JSON.stringify(existing));
} 