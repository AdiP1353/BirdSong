/** Number of user-visible characters (code points), so an emoji counts as one. */
export function charCount(text: string): number {
  return [...text].length;
}
