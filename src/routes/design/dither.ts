import bayer from './dither/bayer.svg?url';
import checker from './dither/checker.svg?url';
import cross from './dither/cross.svg?url';
import diag from './dither/diag.svg?url';
import dots from './dither/dots.svg?url';
import hline from './dither/hline.svg?url';
import vline from './dither/vline.svg?url';

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

const ditherPatternUrls = {
	bayer,
	checker,
	dots,
	hline,
	vline,
	diag,
	cross,
} as const satisfies Record<DitherPattern, string>;

export function ditherPatternUrl(pattern: DitherPattern): string {
	return ditherPatternUrls[pattern];
}
