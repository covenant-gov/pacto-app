export const DITHER_PATTERNS = [
	'bayer',
	'checker',
	'dots',
	'hline',
	'vline',
	'diag',
	'cross',
] as const;

export type DitherPattern = (typeof DITHER_PATTERNS)[number];

export function ditherPatternUrl(pattern: DitherPattern): string {
	return `/dither/${pattern}.svg`;
}
