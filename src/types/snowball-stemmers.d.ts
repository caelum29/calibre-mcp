// Ambient types for snowball-stemmers (ISC, pure-JS port of the official Snowball stemmers).
// The package ships no .d.ts, so we declare the tiny surface we use: newStemmer(lang).stem(word).

declare module "snowball-stemmers" {
  export interface Stemmer {
    stem(word: string): string;
  }
  export function newStemmer(language: string): Stemmer;
  export function algorithms(): string[];
}
