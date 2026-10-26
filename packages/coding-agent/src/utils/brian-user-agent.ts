export function getBrianUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `brian/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
