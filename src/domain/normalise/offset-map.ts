// RED stub (#655): replaced by the real offset map in the GREEN commit.
export interface TextEdit {
  inStart: number;
  inEnd: number;
  outStart: number;
  outEnd: number;
}
export interface OffsetMap {
  readonly edits: readonly TextEdit[];
}
export function toRaw(_map: OffsetMap, pos: number): number {
  return pos;
}
export function toCleaned(_map: OffsetMap, pos: number): number {
  return pos;
}
export function composeEdits(_a: readonly TextEdit[], _b: readonly TextEdit[]): TextEdit[] {
  return [];
}
export function insertionEdits(_ins: readonly { at: number; length: number }[]): TextEdit[] {
  return [];
}
export function encodeOffsetMap(_map: OffsetMap): string {
  return "";
}
export function decodeOffsetMap(_s: string): OffsetMap | undefined {
  return { edits: [] };
}
