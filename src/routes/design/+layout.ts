import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';

export function load(): void {
	if (!dev) redirect(307, '/');
}
