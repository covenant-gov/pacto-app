import bayerSvg from './dither/bayer.svg?raw';
import checkerSvg from './dither/checker.svg?raw';
import crossSvg from './dither/cross.svg?raw';
import diagSvg from './dither/diag.svg?raw';
import dotsSvg from './dither/dots.svg?raw';
import hlineSvg from './dither/hline.svg?raw';
import vlineSvg from './dither/vline.svg?raw';

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

function svgDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

const ditherPatternUrls = {
	bayer: svgDataUrl(bayerSvg),
	checker: svgDataUrl(checkerSvg),
	dots: svgDataUrl(dotsSvg),
	hline: svgDataUrl(hlineSvg),
	vline: svgDataUrl(vlineSvg),
	diag: svgDataUrl(diagSvg),
	cross: svgDataUrl(crossSvg),
} as const satisfies Record<DitherPattern, string>;

export function ditherPatternUrl(pattern: DitherPattern): string {
	return ditherPatternUrls[pattern];
}

export function ditherPatternMaskImage(pattern: DitherPattern): string {
	return `url("${ditherPatternUrls[pattern]}")`;
}

export function ditherMaskStyle(pattern: DitherPattern): string {
	const mask = ditherPatternMaskImage(pattern);
	return [
		`mask-image: ${mask}`,
		`-webkit-mask-image: ${mask}`,
		`mask-size: var(--dither-tile, 8px) var(--dither-tile, 8px)`,
		`-webkit-mask-size: var(--dither-tile, 8px) var(--dither-tile, 8px)`,
		`mask-repeat: repeat`,
		`-webkit-mask-repeat: repeat`,
	].join('; ');
}
