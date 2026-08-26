export function isDesignPath(pathname: string): boolean {
	return pathname === '/design' || pathname.startsWith('/design/');
}

export function createOnce(fn: () => void): () => void {
	let done = false;
	return () => {
		if (done) return;
		done = true;
		fn();
	};
}
